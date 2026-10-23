#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "${script_dir}/.." && pwd)"

cd "${repo_dir}"

if ! command -v node >/dev/null 2>&1; then
  echo "error: node is required" >&2
  exit 1
fi

if ! command -v code >/dev/null 2>&1; then
  echo "error: VS Code CLI 'code' is required" >&2
  exit 1
fi

package_name="$(node -p "require('./package.json').name")"
package_version="$(node -p "require('./package.json').version")"
vsix_path="${repo_dir}/${package_name}-${package_version}.vsix"

if node -e "process.exit(require('./package.json').scripts?.package ? 0 : 1)"; then
  npm run package
elif [ -x "${repo_dir}/node_modules/.bin/vsce" ]; then
  "${repo_dir}/node_modules/.bin/vsce" package --no-dependencies --allow-missing-repository --skip-license
else
  npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository --skip-license
fi

if [ ! -f "${vsix_path}" ]; then
  echo "error: package did not create ${vsix_path}" >&2
  exit 1
fi

code --install-extension "${vsix_path}" --force
echo "installed ${vsix_path}"
