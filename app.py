"""
ShadowPacketGuard – Real-Time Network Packet Analysis and Threat Detection Platform
Application entry point / factory.
"""
import os
import click
from flask import Flask, render_template
from flask_login import LoginManager
from flask_wtf import CSRFProtect

from config import DevelopmentConfig
from models import db, User
from services.packet_capture import PacketCaptureEngine
from services.packet_parser import PacketParser
from services.packet_storage import PacketStorage
from services.threat_detection import ThreatDetector
from services.alert_manager import AlertManager
from services.report_generator import ReportGenerator
from services.utils import setup_logger

from routes.auth import auth_bp
from routes.dashboard import dashboard_bp
from routes.capture import capture_bp
from routes.api import api_bp
from routes.reports import reports_bp

csrf = CSRFProtect()
login_manager = LoginManager()
login_manager.login_view = "auth.login"  # type: ignore[assignment]
login_manager.login_message_category = "info"


def create_app(config_class=DevelopmentConfig):
    app = Flask(__name__)
    app.config.from_object(config_class)

    os.makedirs(os.path.dirname(app.config["SQLALCHEMY_DATABASE_URI"].replace("sqlite:///", "")), exist_ok=True)
    os.makedirs(app.config["LOG_DIR"], exist_ok=True)
    os.makedirs(app.config["REPORT_DIR"], exist_ok=True)

    db.init_app(app)
    csrf.init_app(app)
    login_manager.init_app(app)

    logger = setup_logger("shadowpacketguard", app.config["LOG_DIR"])
    app.logger.handlers = logger.handlers
    app.logger.setLevel(logger.level)

    @login_manager.user_loader
    def load_user(user_id):
        return db.session.get(User, int(user_id))

    # --- Wire up the packet processing pipeline ---
    parser = PacketParser()
    storage = PacketStorage(app, batch_size=app.config["CAPTURE_BATCH_FLUSH_SIZE"])
    alert_manager = AlertManager(app)

    def on_alert(alert_type, severity, source_ip, description):
        engine = app.extensions["netscope_capture_engine"]
        sid = engine.session.session_id or "unknown"
        alert_manager.raise_alert(sid, alert_type, severity, source_ip, description)
        logger.warning("ALERT [%s/%s] src=%s :: %s", severity, alert_type, source_ip, description)

    threat_detector = ThreatDetector(app.config, on_alert)
    capture_engine = PacketCaptureEngine(app, storage, parser, threat_detector, app.config)
    report_generator = ReportGenerator(app.config["REPORT_DIR"])

    app.extensions["netscope_capture_engine"] = capture_engine
    app.extensions["netscope_report_generator"] = report_generator

    app.register_blueprint(auth_bp)
    app.register_blueprint(dashboard_bp)
    app.register_blueprint(capture_bp)
    app.register_blueprint(api_bp)
    app.register_blueprint(reports_bp)

    with app.app_context():
        db.create_all()

    @app.cli.command("create-admin")
    @click.option("--username", "username", prompt=True, required=True)
    @click.option("--email", "email", prompt=True, required=True)
    @click.option("--password", "password", prompt=True, hide_input=True, confirmation_prompt=False, required=True)
    def create_admin(username, email, password):
        """Create an admin user: flask --app app.py create-admin --username <username> --email <email> --password <password>"""
        if User.query.filter_by(username=username).first():
            click.echo("A user with that username already exists.")
            return
        user = User()
        user.username = username
        user.email = email
        user.role = "admin"
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        click.echo(f"Admin user '{username}' created.")

    @app.errorhandler(404)
    def not_found(e):
        if getattr(e, "description", None):
            message = e.description
        else:
            message = "The page you requested could not be found."
        return render_template("404.html", message=message), 404

    @app.errorhandler(500)
    def server_error(e):
        logger.exception("Unhandled server error")
        return render_template("500.html"), 500

    return app


app = create_app()

if __name__ == "__main__":
    # Keep capture control local by default. Enable debug explicitly through
    # the environment when developing; never enable it implicitly.
    debug = os.environ.get("SHADOWPACKETGUARD_DEBUG", "").lower() in {"1", "true", "yes"}
    app.run(host="127.0.0.1", port=5000, debug=debug, use_reloader=False, threaded=True)
