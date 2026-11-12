#!/usr/bin/env bash
# Root-only install. Config is the reviewed domain_controller_config output.
set -euo pipefail
source_dir=${1:?Source directory is required}
config=${2:?Controller config JSON is required}
install -d -m 755 /opt/gemihub-domains
install -m 755 "$source_dir/domain-controller.py" /opt/gemihub-domains/controller.py
install -m 600 "$config" /etc/gemihub-domains.json
cat > /etc/systemd/system/gemihub-domains.service <<'UNIT'
[Unit]
Description=Connect verified GemiHub storefront domains
After=network-online.target nginx.service
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /opt/gemihub-domains/controller.py
TimeoutStartSec=5min
UMask=0077
PrivateTmp=true
NoNewPrivileges=true
UNIT
cat > /etc/systemd/system/gemihub-domains.timer <<'UNIT'
[Unit]
Description=Reconcile storefront DNS and HTTPS every minute
[Timer]
OnBootSec=30s
OnUnitInactiveSec=60s
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now gemihub-domains.timer
