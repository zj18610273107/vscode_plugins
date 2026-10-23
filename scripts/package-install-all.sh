#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "${script_dir}/.." && pwd)"

cd "${repo_dir}"

usage()
{
  cat <<EOF
usage: ${0##*/} [extension_dir ...]

Without arguments, package and install all extensions.
With arguments, package and install only the selected extension directories.
An extension directory is any top-level directory containing package.json.
EOF
}

for tool in node npm code; do
  if ! command -v "${tool}" >/dev/null 2>&1; then
    echo "error: ${tool} is required" >&2
    exit 1
  fi
done

extension_paths=()

for package_json in "${repo_dir}"/*/package.json; do
  [ -f "${package_json}" ] || continue
  extension_paths+=("$(basename "$(dirname "${package_json}")")")
done

if [ "${#extension_paths[@]}" -eq 0 ]; then
  echo "error: no extension directories found" >&2
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
  local package_name
  local package_version
  local vsix_path

  echo "==> package and install ${extension_path}"
  cd "${extension_dir}"

  package_name="$(node -p "require('./package.json').name")"
  package_version="$(node -p "require('./package.json').version")"
  vsix_path="${extension_dir}/${package_name}-${package_version}.vsix"

  if [ -f package-lock.json ] && [ ! -d node_modules ]; then
    npm ci
  fi

  # vsce runs the vscode:prepublish build step of each extension.
  if [ -x node_modules/.bin/vsce ]; then
    node_modules/.bin/vsce package --no-dependencies --allow-missing-repository --skip-license
  else
    npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository --skip-license
  fi

  if [ ! -f "${vsix_path}" ]; then
    echo "error: package did not create ${vsix_path}" >&2
    exit 1
  fi

  code --install-extension "${vsix_path}" --force
  echo "installed ${vsix_path}"
}

selected_paths=()

if [ "$#" -eq 0 ]; then
  selected_paths=("${extension_paths[@]}")
else
  for requested_path in "$@"; do
    requested_path="${requested_path%/}"
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
