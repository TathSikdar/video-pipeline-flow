#!/bin/bash
# VPS Host IPv6 SLAAC Evasion Rotation Script
# Target Interface: eth0
# Subnet: /64

# Ensure script is run as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root."
  exit 1
fi

INTERFACE="eth0"

# Infinite loop for the Docker container
while true; do
  echo "========== Starting IPv6 Rotation =========="
  
  # Auto-detect the primary /64 IPv6 prefix assigned to eth0
  # E.g. extracts "2604:a880:400:d0" from "inet6 2604:a880:400:d0::1/64"
  PREFIX=$(ip -6 addr show $INTERFACE | grep -oP '(?<=inet6 )[0-9a-fA-F:]+(?=/64)' | head -n 1 | cut -d: -f1-4)

  if [ -z "$PREFIX" ]; then
    echo "ERROR: Could not detect a valid /64 IPv6 prefix on $INTERFACE."
    echo "Ensure IPv6 is enabled on your host. Retrying in 5 minutes..."
    sleep 300
    continue
  fi

  # Generate a random 64-bit interface ID (4 hex blocks)
  RANDOM_IID=$(printf '%x:%x:%x:%x\n' $(($RANDOM%65536)) $(($RANDOM%65536)) $(($RANDOM%65536)) $(($RANDOM%65536)))
  NEW_IP="${PREFIX}:${RANDOM_IID}"

  echo "Detected Prefix: $PREFIX"
  echo "Binding new IPv6 address: $NEW_IP to $INTERFACE"

  # Add the new address
  ip -6 addr add $NEW_IP/64 dev $INTERFACE

  # Flush routing cache to enforce the new egress IP
  ip -6 route flush cache

  echo "Successfully rotated egress IPv6 address!"
  echo "Sleeping for 30 minutes..."
  echo "==========================================="
  
  # Sleep for 30 minutes (1800 seconds)
  sleep 1800
done
