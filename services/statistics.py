"""
Aggregate statistics computed from stored packets for a given session.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from models import db, Packet


class StatisticsService:
    @staticmethod
    def summary(session_id: str) -> dict:
        base = db.session.query(Packet).filter(Packet.session_id == session_id)

        total_packets = base.count()
        avg_size = base.with_entities(func.avg(Packet.packet_size)).scalar() or 0
        total_bytes = base.with_entities(func.sum(Packet.packet_size)).scalar() or 0

        # SQLite stores SQLAlchemy DateTime values without timezone metadata.
        # The application stores UTC, so compare against a naive UTC boundary.
        window_start = (
            datetime.now(timezone.utc) - timedelta(seconds=5)
        ).replace(tzinfo=None)
        recent = base.filter(Packet.timestamp >= window_start)
        recent_count = recent.count()
        recent_bytes = recent.with_entities(func.sum(Packet.packet_size)).scalar() or 0

        return {
            "total_packets": total_packets,
            "average_packet_size": round(float(avg_size), 2),
            "total_bytes": int(total_bytes),
            "packets_per_second": round(recent_count / 5.0, 2),
            "bandwidth_bytes_per_second": round(float(recent_bytes) / 5.0, 2),
        }

    @staticmethod
    def protocol_distribution(session_id: str) -> list[dict]:
        rows = (
            db.session.query(Packet.protocol, func.count(Packet.id))
            .filter(Packet.session_id == session_id)
            .group_by(Packet.protocol)
            .order_by(func.count(Packet.id).desc())
            .all()
        )
        return [{"protocol": p or "UNKNOWN", "count": c} for p, c in rows]

    @staticmethod
    def top_source_ips(session_id: str, limit: int = 10) -> list[dict]:
        rows = (
            db.session.query(Packet.src_ip, func.count(Packet.id))
            .filter(Packet.session_id == session_id, Packet.src_ip.isnot(None))
            .group_by(Packet.src_ip)
            .order_by(func.count(Packet.id).desc())
            .limit(limit)
            .all()
        )
        return [{"ip": ip, "count": c} for ip, c in rows]

    @staticmethod
    def top_destination_ips(session_id: str, limit: int = 10) -> list[dict]:
        rows = (
            db.session.query(Packet.dst_ip, func.count(Packet.id))
            .filter(Packet.session_id == session_id, Packet.dst_ip.isnot(None))
            .group_by(Packet.dst_ip)
            .order_by(func.count(Packet.id).desc())
            .limit(limit)
            .all()
        )
        return [{"ip": ip, "count": c} for ip, c in rows]

    @staticmethod
    def top_ports(session_id: str, limit: int = 10) -> list[dict]:
        rows = (
            db.session.query(Packet.dst_port, func.count(Packet.id))
            .filter(Packet.session_id == session_id, Packet.dst_port.isnot(None))
            .group_by(Packet.dst_port)
            .order_by(func.count(Packet.id).desc())
            .limit(limit)
            .all()
        )
        return [{"port": p, "count": c} for p, c in rows]

    @staticmethod
    def packet_rate_timeseries(session_id: str) -> list[dict]:
        """Packets per second-bucket, for the live line chart."""
        rows = (
            db.session.query(
                func.strftime("%Y-%m-%d %H:%M:%S", Packet.timestamp).label("bucket"),
                func.count(Packet.id),
            )
            .filter(Packet.session_id == session_id)
            .group_by("bucket")
            .order_by("bucket")
            .all()
        )
        return [{"time": b, "count": c} for b, c in rows]
