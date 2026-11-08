#!/usr/bin/env bash
set -euo pipefail

project=${1:?Shared project is required}
zone=${2:?Shared zone is required}
instance=${3:?Shared instance is required}
image=${4:?Image is required}
if [[ ${5:-true} != true ]]; then exit 0; fi

umask 077
key_dir=$(mktemp -d)
ssh_key="$key_dir/build-ssh"
cleanup() {
  local status=$?
  trap - EXIT
  if [[ -f "$ssh_key.pub" ]]; then
    gcloud compute os-login ssh-keys remove --project="$project" --key-file="$ssh_key.pub" --quiet ||
      echo 'WARNING: Could not remove the build SSH key; it expires after 10 minutes.' >&2
  fi
  rm -f "$ssh_key" "$ssh_key.pub"
  rmdir "$key_dir" || true
  exit "$status"
}
trap cleanup EXIT

# A custom key path does not create the directory used for gcloud's known hosts.
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
ssh_args=(compute ssh "$instance" --project="$project" --zone="$zone"
  --tunnel-through-iap --ssh-key-file="$ssh_key" --ssh-key-expire-after=10m --quiet)

# Check authentication before doing any remote work. Retry only SSH transport/auth
# failures; never repeat deployment when a remote command has already started.
for attempt in 1 2 3; do
  if gcloud "${ssh_args[@]}" --command=true; then
    break
  else
    status=$?
  fi
  if [[ $status != 255 || $attempt == 3 ]]; then exit "$status"; fi
  echo "SSH connection check failed; retrying ($attempt/3)." >&2
  sleep "$((attempt * 5))"
done

deploy_script=$(base64 -w0 "$(dirname "$0")/deploy-gemihub.py")
printf -v image_arg '%q' "$image"
gcloud "${ssh_args[@]}" \
  --command="printf '%s' '$deploy_script' | base64 -d | sudo python3 - --image $image_arg"
