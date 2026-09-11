#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "${script_dir}/.." && pwd)"

cd "${repo_dir}"

usage()
{
  cat <<EOF
usage: ${0##*/} [extension_path ...]

Without arguments, package and install all extensions.
With arguments, package and install only the selected extension paths.
EOF
}

if [ ! -f "${repo_dir}/extensions.conf" ]; then
  echo "error: extensions.conf not found" >&2
  exit 1
fi

declare -A extension_urls=()
extension_paths=()

while read -r extension_key extension_path; do
  extension_name="${extension_key#extension.}"
  extension_name="${extension_name%.path}"
  extension_url="$(git config --file "${repo_dir}/extensions.conf" \
    --get "extension.${extension_name}.url" || true)"

  if [ -z "${extension_url}" ]; then
    echo "error: no URL configured for ${extension_path}" >&2
    exit 1
  fi

  extension_paths+=("${extension_path}")
  extension_urls["${extension_path}"]="${extension_url}"
done < <(
  git config --file "${repo_dir}/extensions.conf" --get-regexp '^extension\..*\.path$'
)

if [ "${#extension_paths[@]}" -eq 0 ]; then
  echo "error: no extensions found in extensions.conf" >&2
  exit 1
fi

is_known_extension()
{
  local requested_path="$1"
  local extension_path

  for extension_path in "${extension_paths[@]}"; do
    if [ "${extension_path}" = "${requested_path}" ]; then
      return 0
    fi
  done

  return 1
}

print_available_extensions()
{
  local extension_path

  echo "available extensions:" >&2
  for extension_path in "${extension_paths[@]}"; do
    echo "  ${extension_path}" >&2
  done
}

install_extension()
{
  local extension_path="$1"
  local extension_dir="${repo_dir}/${extension_path}"
  local package_install_script="${extension_dir}/scripts/package-install.sh"
  local extension_url="${extension_urls[${extension_path}]}"
  local package_status

  if [ ! -e "${extension_dir}" ]; then
    echo "==> clone ${extension_path}"
    git clone "${extension_url}" "${extension_dir}"
  fi

  if ! git -C "${extension_dir}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "error: ${extension_path} is not an initialized git repository" >&2
    exit 1
  fi

  if [ -n "$(git -C "${extension_dir}" status --porcelain)" ]; then
    echo "error: ${extension_path} has local changes; commit or clean it before install" >&2
    exit 1
  fi

  echo "==> update ${extension_path} to origin/master"
  git -C "${extension_dir}" fetch origin master
  if git -C "${extension_dir}" show-ref --verify --quiet refs/heads/master; then
    git -C "${extension_dir}" switch master
  else
    git -C "${extension_dir}" switch --track -c master origin/master
  fi
  git -C "${extension_dir}" pull --ff-only origin master

  if [ ! -x "${package_install_script}" ]; then
    echo "error: ${extension_path} does not provide scripts/package-install.sh" >&2
    exit 1
  fi

  echo "==> package and install ${extension_path}"
  set +e
  "${package_install_script}"
  package_status="$?"
  set -e

  return "${package_status}"
}

selected_paths=()

if [ "$#" -eq 0 ]; then
  selected_paths=("${extension_paths[@]}")
else
  for requested_path in "$@"; do
    case "${requested_path}" in
      -h|--help)
        usage
        exit 0
        ;;
    esac

    if ! is_known_extension "${requested_path}"; then
      echo "error: unknown extension: ${requested_path}" >&2
      print_available_extensions
      exit 1
    fi

    selected_paths+=("${requested_path}")
  done
fi

for extension_path in "${selected_paths[@]}"; do
  install_extension "${extension_path}"
done
