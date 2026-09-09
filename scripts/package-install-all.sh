#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "${script_dir}/.." && pwd)"

cd "${repo_dir}"

if [ ! -f "${repo_dir}/.gitmodules" ]; then
  echo "error: .gitmodules not found" >&2
  exit 1
fi

mapfile -t submodule_paths < <(
  git config --file "${repo_dir}/.gitmodules" --get-regexp '^submodule\..*\.path$' |
    awk '{ print $2 }'
)

if [ "${#submodule_paths[@]}" -eq 0 ]; then
  echo "error: no submodules found in .gitmodules" >&2
  exit 1
fi

for submodule_path in "${submodule_paths[@]}"; do
  package_install_script="${repo_dir}/${submodule_path}/scripts/package-install.sh"

  if [ ! -x "${package_install_script}" ]; then
    echo "error: ${submodule_path} does not provide scripts/package-install.sh" >&2
    exit 1
  fi

  echo "==> package and install ${submodule_path}"
  "${package_install_script}"
done
