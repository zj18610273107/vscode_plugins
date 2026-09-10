#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "${script_dir}/.." && pwd)"

cd "${repo_dir}"

usage()
{
  cat <<EOF
usage: ${0##*/} [submodule_path ...]

Without arguments, package and install all submodules.
With arguments, package and install only the selected submodule paths.
EOF
}

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

is_known_submodule()
{
  local requested_path="$1"
  local submodule_path

  for submodule_path in "${submodule_paths[@]}"; do
    if [ "${submodule_path}" = "${requested_path}" ]; then
      return 0
    fi
  done

  return 1
}

print_available_submodules()
{
  local submodule_path

  echo "available submodules:" >&2
  for submodule_path in "${submodule_paths[@]}"; do
    echo "  ${submodule_path}" >&2
  done
}

install_submodule()
{
  local submodule_path="$1"
  local submodule_dir="${repo_dir}/${submodule_path}"
  local package_install_script="${submodule_dir}/scripts/package-install.sh"
  local recorded_commit
  local package_status

  recorded_commit="$(git rev-parse "HEAD:${submodule_path}")"

  if ! git -C "${submodule_dir}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "error: ${submodule_path} is not an initialized git submodule" >&2
    exit 1
  fi

  if [ -n "$(git -C "${submodule_dir}" status --porcelain)" ]; then
    echo "error: ${submodule_path} has local changes; commit or clean it before install" >&2
    exit 1
  fi

  echo "==> update ${submodule_path} to origin/master"
  git -C "${submodule_dir}" fetch origin master
  git -C "${submodule_dir}" checkout --detach origin/master

  if [ ! -x "${package_install_script}" ]; then
    echo "error: ${submodule_path} does not provide scripts/package-install.sh" >&2
    git -C "${submodule_dir}" checkout --detach "${recorded_commit}"
    exit 1
  fi

  echo "==> package and install ${submodule_path}"
  set +e
  "${package_install_script}"
  package_status="$?"
  set -e

  echo "==> restore ${submodule_path} to ${recorded_commit}"
  git -C "${submodule_dir}" checkout --detach "${recorded_commit}"

  return "${package_status}"
}

selected_paths=()

if [ "$#" -eq 0 ]; then
  selected_paths=("${submodule_paths[@]}")
else
  for requested_path in "$@"; do
    case "${requested_path}" in
      -h|--help)
        usage
        exit 0
        ;;
    esac

    if ! is_known_submodule "${requested_path}"; then
      echo "error: unknown submodule: ${requested_path}" >&2
      print_available_submodules
      exit 1
    fi

    selected_paths+=("${requested_path}")
  done
fi

for submodule_path in "${selected_paths[@]}"; do
  install_submodule "${submodule_path}"
done
