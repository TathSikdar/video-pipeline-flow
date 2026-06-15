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
# Replace this with your actual VPS provider's assigned /64 prefix
PREFIX="2001:db8:1234:5678"

# Generate a random 64-bit interface ID (4 hex blocks)
RANDOM_IID=$(printf '%x:%x:%x:%x\n' $(($RANDOM%65536)) $(($RANDOM%65536)) $(($RANDOM%65536)) $(($RANDOM%65536)))
NEW_IP="${PREFIX}:${RANDOM_IID}"

echo "Binding new IPv6 address: $NEW_IP to $INTERFACE"

# Add the new address
ip -6 addr add $NEW_IP/64 dev $INTERFACE

# Flush routing cache to enforce the new egress IP
ip -6 route flush cache

echo "Successfully rotated egress IPv6 address!"
