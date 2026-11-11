#!/bin/bash
set -euo pipefail
fail() { builtin printf '%s\n' "Bootstrap staging blocked: $*" >&2; exit 1; }
# The OS loader, runner and initial environment are trusted before this script starts.
for name in BASH_ENV ENV NODE_OPTIONS NODE_PATH NODE_EXTRA_CA_CERTS LD_PRELOAD LD_LIBRARY_PATH; do
  if builtin declare -p "$name" >/dev/null 2>&1; then fail "inherited startup control $name"; fi
done
for name in ${!DYLD_@}; do fail "inherited loader control $name"; done
[[ $(/usr/bin/uname -sm) == 'Darwin arm64' ]] || fail 'unsupported host (Darwin arm64 only)'
[[ $# == 3 ]] || fail 'reviewed fixture root, manifest digest and launcher digest required'
[[ -x /usr/bin/openssl ]] || fail 'native OS SHA-256 utility missing'
root=$1
manifestHash=$2
launcherHash=$3
safe_path() { [[ $1 =~ ^/[a-zA-Z0-9_./-]+$ && $1 != *'/../'* && $1 != *'/./'* && $1 != *'//'* && $1 != */ && $1 != */.. && $1 != */. ]]; }
safe_path "$root" || fail 'invalid owned root'
[[ -d $root && ! -L $root && $(cd -P -- "$root" && builtin pwd -P) == "$root" ]] || fail 'noncanonical owned root'
[[ $manifestHash =~ ^[a-f0-9]{64}$ && $launcherHash =~ ^[a-f0-9]{64}$ ]] || fail 'missing reviewed digests'
owned() {
  [[ $(/usr/bin/stat -f %u "$1") == "$EUID" ]] || fail 'input not owned by fixture runner'
  local mode
  mode=$(/usr/bin/stat -f %Lp "$1")
  (( (8#$mode & 0022) == 0 )) || fail 'input writable outside fixture owner'
}
owned "$root"
[[ $0 == "$root/verified-bootstrap-darwin.sh" ]] || fail 'launcher path outside owned root'
regular() {
  [[ -f $1 && ! -L $1 ]] || fail 'nonregular input'
  owned "$1"
  [[ $(/usr/bin/stat -f %l "$1") == 1 ]] || fail 'hard links prohibited'
  local size
  size=$(/usr/bin/stat -f %z "$1")
  [[ $size =~ ^[0-9]+$ && $size -gt 0 && $size -le 1048576 ]] || fail 'input size outside fixture bounds'
}
hash() {
  regular "$1"
  local result
  result=$(/usr/bin/openssl dgst -sha256 "$1")
  result=${result##* }
  [[ $result =~ ^[a-f0-9]{64}$ ]] || fail 'invalid native hash result'
  builtin printf '%s' "$result"
}
[[ $(hash "$0") == "$launcherHash" ]] || fail 'launcher identity mismatch'
manifest=$root/reviewed-bootstrap.manifest
[[ $(hash "$manifest") == "$manifestHash" ]] || fail 'manifest approval mismatch'
for dir in archives node pnpm source; do
  [[ -d $root/$dir && ! -L $root/$dir && $(cd -P -- "$root/$dir" && builtin pwd -P) == "$root/$dir" ]] || fail 'invalid inventory root'
  owned "$root/$dir"
done
[[ ! -e $root/source/node_modules && ! -L $root/source/node_modules && ! -e $root/home && ! -L $root/home ]] || fail 'preexisting dependencies or profile/store'
IFS= read -r header < "$manifest"
[[ $header == 'reviewed-owned-fixture-staging|darwin|arm64|24.22.2|10.33.0|inventory-not-extraction-proof' ]] || fail 'unsupported review profile'
paths=()
kinds=()
hashes=()
count=0
while IFS='|' read -r kind expected part extra; do
  [[ $count -gt 0 ]] || { count=1; continue; }
  [[ -z $extra && $part =~ ^(archives|node|pnpm|source)/[a-zA-Z0-9_./-]+$ && $part != *'/../'* && $part != *'/./'* && $part != *'//'* && $part != */ && $part != */.. && $part != */. ]] || fail 'invalid inventory path'
  [[ $kind == F || $kind == D ]] || fail 'invalid inventory type'
  for prior in "${paths[@]+${paths[@]}}"; do [[ $prior != "$part" ]] || fail 'duplicate inventory path'; done
  paths+=("$part"); kinds+=("$kind"); hashes+=("$expected")
  count=$((count + 1))
  [[ $count -le 257 ]] || fail 'inventory exceeds bound'
done < "$manifest"
[[ ${#paths[@]} -gt 0 ]] || fail 'empty inventory'
# Check every path/type before opening any inventory file; concurrent writers are excluded.
seen=0
inventoryComplete=0
while IFS= read -r -d '' path; do
  if [[ $path == inventory-complete ]]; then inventoryComplete=1; continue; fi
  part=${path#"$root/"}
  found=0
  for ((i=0; i<${#paths[@]}; i++)); do
    if [[ ${paths[i]} == "$part" ]]; then
      [[ ! -L $path ]] || fail 'links prohibited'
      owned "$path"
      if [[ ${kinds[i]} == D ]]; then
        [[ -d $path && ${hashes[i]} == - ]] || fail 'directory type mismatch'
      else
        regular "$path"
        [[ ${hashes[i]} =~ ^[a-f0-9]{64}$ ]] || fail 'invalid file digest'
      fi
      found=1; break
    fi
  done
  [[ $found == 1 ]] || fail 'extra distribution/source path'
  seen=$((seen + 1))
  [[ $seen -le 256 ]] || fail 'inventory exceeds bound'
done < <(/usr/bin/find "$root/archives" "$root/node" "$root/pnpm" "$root/source" -mindepth 1 -print0 && builtin printf 'inventory-complete\0')
[[ $inventoryComplete == 1 && $seen == ${#paths[@]} ]] || fail 'missing or unreadable distribution/source path'
for ((i=0; i<${#paths[@]}; i++)); do
  if [[ ${kinds[i]} == F ]]; then
    [[ $(hash "$root/${paths[i]}") == "${hashes[i]}" ]] || fail 'altered archive/distribution/source bytes'
  fi
done
for part in archives/node.fixture archives/pnpm.fixture node/bin/node pnpm/bin/pnpm.cjs source/entry.mjs source/package.json source/pnpm-lock.yaml source/pnpm-workspace.yaml source/bootstrap-stage.ts source/install-policy.ts source/policy.json; do
  regular "$root/$part"
done
[[ -x $root/node/bin/node ]] || fail 'owned node stand-in not executable'
# The shell profile only reaches the first entry. Post-Node execution uses installEnvironment.
exec /usr/bin/env -i HOME="$root" USERPROFILE="$root" PATH=/usr/bin:/bin CI=true OMB_EVAL_LIVE=0 "$root/node/bin/node" "$root/source/entry.mjs"
