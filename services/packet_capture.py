"""
Live packet capture engine.

Runs Scapy's AsyncSniffer in a background thread so Flask requests are never
blocked and Stop can terminate an idle capture without waiting for another
packet to arrive.
"""
import threading
import uuid
from datetime import datetime, timezone

from services.utils import setup_logger


class CaptureSession:
    """Holds the live/last state of one capture run for the UI to read."""

    def __init__(self):
        self.session_id = None
        self.interface = None
        self.status = "stopped"   # stopped | running | paused
        self.packet_count = 0
        self.started_at = None
        self.error = None

    def to_dict(self):
        return {
            "session_id": self.session_id,
            "interface": self.interface,
            "status": self.status,
            "packet_count": self.packet_count,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "error": self.error,
        }


class PacketCaptureEngine:
    def __init__(self, app, storage, parser, threat_detector, config):
        self.app = app
        self.storage = storage
        self.parser = parser
        self.threat_detector = threat_detector
        self.cfg = config
        self.logger = setup_logger("packet_capture", config["LOG_DIR"])

        self.session = CaptureSession()
        self._thread = None
        self._sniffer = None
        self._stop_event = threading.Event()
        self._pause_event = threading.Event()
        self._state_lock = threading.RLock()

    def list_interfaces(self):
        try:
            from scapy.arch.windows import get_windows_if_list
            windows_ifaces = get_windows_if_list()
            if windows_ifaces:
                names = [
                    entry.get("name")
                    for entry in windows_ifaces
                    if entry.get("name")
                ]
                return list(dict.fromkeys(names))
        except Exception:
            pass

        try:
            from scapy.all import get_if_list
            return get_if_list()
        except Exception as exc:
            self.logger.error("Failed to list interfaces: %s", exc)
            return []

    def start(self, interface: str):
        interface = str(interface or "").strip()
        if not interface:
            return False, "A network interface is required."

        with self._state_lock:
            if self.session.status in ("running", "paused"):
                return False, "Capture is already active."

            if self._thread and self._thread.is_alive():
                return False, "Previous capture is still shutting down. Please try again."

            self.session = CaptureSession()
            self.session.session_id = uuid.uuid4().hex[:16]
            self.session.interface = interface
            self.session.status = "running"
            self.session.started_at = datetime.now(timezone.utc)
            self._stop_event.clear()
            self._pause_event.clear()
            self._sniffer = None

            self._thread = threading.Thread(
                target=self._run,
                name="shadowpacketguard-capture",
                daemon=True,
            )
            self._thread.start()

        self.logger.info(
            "Capture started on %s (session=%s)",
            interface,
            self.session.session_id,
        )
        return True, self.session.session_id

    def pause(self):
        with self._state_lock:
            if self.session.status != "running":
                return False, "Capture is not running."
            self._pause_event.set()
            self.session.status = "paused"
        return True, "Paused"

    def resume(self):
        with self._state_lock:
            if self.session.status != "paused":
                return False, "Capture is not paused."
            self._pause_event.clear()
            self.session.status = "running"
        return True, "Resumed"

    def stop(self):
        with self._state_lock:
            if self.session.status == "stopped" and not (
                self._thread and self._thread.is_alive()
            ):
                return False, "Capture is not running."

            self._stop_event.set()
            self._pause_event.clear()
            sniffer = self._sniffer
            thread = self._thread

        # AsyncSniffer.stop() wakes an idle capture immediately. This avoids
        # the old stop_filter behaviour where Stop could wait indefinitely
        # until another packet arrived.
        if sniffer is not None:
            try:
                sniffer.stop(join=False)
            except Exception as exc:
                self.logger.debug("Sniffer stop warning: %s", exc)

        if thread and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=3.0)

        with self._state_lock:
            self.session.status = "stopped"

        try:
            self.storage.flush()
        except Exception as exc:
            self.session.error = f"Database flush failed: {exc}"
            self.logger.error(self.session.error)

        self.logger.info(
            "Capture stopped (session=%s, packets=%d)",
            self.session.session_id,
            self.session.packet_count,
        )
        return True, "Stopped"

    def status(self):
        with self._state_lock:
            return self.session.to_dict()

    def _run(self):
        try:
            from scapy.all import AsyncSniffer
        except Exception as exc:
            self.session.status = "stopped"
            self.session.error = f"Scapy unavailable: {exc}"
            self.logger.error(self.session.error)
            return

        def _on_packet(pkt):
            if self._stop_event.is_set():
                return

            # Pausing intentionally stops processing while keeping the
            # sniffer alive. Resume therefore continues the same session.
            while self._pause_event.is_set() and not self._stop_event.is_set():
                self._pause_event.wait(timeout=0.2)

            if self._stop_event.is_set():
                return

            captured_at = datetime.now(timezone.utc)
            record = self.parser.parse(
                pkt,
                self.session.interface,
                captured_at=captured_at,
            )
            if record is None:
                return

            try:
                self.storage.add(self.session.session_id, record)
                self.session.packet_count += 1
                self.threat_detector.process(record)
            except Exception as exc:
                self.logger.error("Packet processing error: %s", exc)

            if self.session.packet_count >= self.cfg["MAX_PACKETS_PER_SESSION"]:
                self._stop_event.set()
                try:
                    if self._sniffer:
                        self._sniffer.stop(join=False)
                except Exception:
                    pass

        try:
            sniffer = AsyncSniffer(
                iface=self.session.interface,
                prn=_on_packet,
                store=False,
            )
            self._sniffer = sniffer
            sniffer.start()
            sniffer.join()
        except PermissionError:
            self.session.error = (
                "Permission denied opening the interface. Run VS Code / terminal "
                "as Administrator (Windows) or with sudo (Linux/macOS)."
            )
            self.logger.error(self.session.error)
        except Exception as exc:
            self.session.error = str(exc)
            self.logger.error("Capture error: %s", exc)
        finally:
            try:
                self.storage.flush()
            except Exception as exc:
                self.logger.error("Final packet flush failed: %s", exc)
            with self._state_lock:
                self.session.status = "stopped"
                self._sniffer = None
