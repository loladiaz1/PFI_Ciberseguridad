#!/bin/bash
# Optional bootstrap: installs the Wazuh all-in-one stack (manager + indexer +
# dashboard) on first boot. Only used when install_wazuh = true.
# Docs: https://documentation.wazuh.com/current/quickstart.html
set -euxo pipefail

# No depender de que cloud-init deje sudo sin password para "ubuntu" (a veces no lo hace).
echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/99-ubuntu-nopasswd
chmod 440 /etc/sudoers.d/99-ubuntu-nopasswd

cd /root
curl -sO https://packages.wazuh.com/4.x/wazuh-install.sh

# -a : all-in-one single-node install
# -i : ignore hardware/OS pre-checks (t3.medium's 4 GB is at the edge of the RAM check)
bash ./wazuh-install.sh -a -i 2>&1 | tee /root/wazuh-install.log

# After it finishes, the admin + API passwords live inside wazuh-install-files.tar:
#   sudo tar -xf wazuh-install-files.tar
#   sudo cat wazuh-install-files/wazuh-passwords.txt
