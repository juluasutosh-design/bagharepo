#!/usr/bin/env bash

set -euo pipefail

: "${OVERRIDE_YAML:?OVERRIDE_YAML is required}"
: "${REF_FILE:?REF_FILE is required}"
: "${GITHUB_ENV:?GITHUB_ENV is required}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/yamladd-common.sh"

validate_path_and_type() {
  local path_str="$1"
  local value_str="$2"
  local strict_type="${3:-true}"

  local path_parts=()
  split_top_level "$path_str" "~" path_parts

  if [[ ${#path_parts[@]} -lt 1 ]]; then
    echo "Invalid path: $path_str"
    return 1
  fi

  local first
  first="$(trim "${path_parts[0]}")"

  local resolved_path
  if resolved_path="$(resolve_single_token_path "$first")"; then
    local rebuilt_path_parts=()
    split_top_level "$resolved_path" "~" rebuilt_path_parts
    for ((idx=1; idx<${#path_parts[@]}; idx++)); do
      rebuilt_path_parts+=("${path_parts[$idx]}")
    done

    path_str=""
    for part in "${rebuilt_path_parts[@]}"; do
      part="$(trim "$part")"
      [[ -z "$part" ]] && continue
      if [[ -z "$path_str" ]]; then
        path_str="$part"
      else
        path_str+="~$part"
      fi
    done

    split_top_level "$path_str" "~" path_parts
    first="$(trim "${path_parts[0]}")"
  else
    local rc=$?
    if [[ $rc -eq 2 ]]; then
      return 1
    fi
  fi

  local expr=".. | select(type == \"!!map\" and has(\"$first\")) | .\"$first\""

  if ! yq -e "$expr | select(. != null)" "$REF_FILE" >/dev/null 2>&1; then
    echo "Path not found in referenceChart.yml: $path_str"
    echo "Parent key '$first' not found in referenceChart.yml."
    return 1
  fi

  for ((p=1; p<${#path_parts[@]}; p++)); do
    local seg
    seg="$(trim "${path_parts[$p]}")"
    local next_expr="$expr | select(type == \"!!map\" and has(\"$seg\")) | .\"$seg\""

    if ! yq -e "$next_expr | select(. != null)" "$REF_FILE" >/dev/null 2>&1; then
      if yq -e "$expr | select(tag != \"!!map\" and tag != \"!!seq\")" "$REF_FILE" >/dev/null 2>&1; then
        echo "Key '${seg}' is not valid under '${path_parts[$((p-1))]}'"
        echo "Expected scalar value under '${path_parts[$((p-1))]}'"
        return 1
      fi

      echo "Path not found in referenceChart.yml: $path_str"
      echo "Child key '$seg' not found under '${path_parts[$((p-1))]}'."

      parent_key="${path_parts[$((p-1))]}"
      parent_children="$(yq -r ".\"$parent_key\" | keys | .[]" "$REF_FILE" 2>/dev/null)"

      if [[ -n "$parent_children" ]]; then
        input_lower="$(echo "$seg" | tr '[:upper:]' '[:lower:]')"
        input_len=${#input_lower}
        fuzzy_results=()

        for ((len=1; len<=input_len; len++)); do
          substring="${input_lower:0:$len}"
          if [[ ${#fuzzy_results[@]} -gt 0 ]]; then
            break
          fi
          while IFS= read -r child; do
            [[ -z "$child" ]] && continue
            child_lower="$(echo "$child" | tr '[:upper:]' '[:lower:]')"
            if [[ "$child_lower" == "$substring"* ]]; then
              fuzzy_results+=("${path_parts[0]}~${parent_key}~${child}")
            fi
          done <<< "$parent_children"
        done

        if [[ ${#fuzzy_results[@]} -eq 0 ]]; then
          while IFS= read -r child; do
            [[ -z "$child" ]] && continue
            child_lower="$(echo "$child" | tr '[:upper:]' '[:lower:]')"
            if [[ "$child_lower" == *"$input_lower"* ]]; then
              fuzzy_results+=("${path_parts[0]}~${parent_key}~${child}")
            fi
          done <<< "$parent_children"
        fi

        if [[ ${#fuzzy_results[@]} -gt 0 ]]; then
          echo "Did you mean one of these?"
          printf '  %s\n' "${fuzzy_results[@]}"
        fi
      fi
      return 1
    fi

    expr="$next_expr"
  done

  if [[ "$strict_type" == "false" ]]; then
    yq -e "$expr | select(tag == \"!!map\")" "$REF_FILE" >/dev/null 2>&1 || {
      echo "Type mismatch at $path_str: expected object/map in referenceChart.yml"
      return 1
    }
    return 0
  fi

  local actual_kind
  actual_kind="$(infer_value_kind "$value_str")"

  if [[ "$actual_kind" == "array" ]]; then
    yq -e "$expr | select(tag == \"!!seq\")" "$REF_FILE" >/dev/null 2>&1 || {
      echo "Type mismatch at $path_str: expected array in referenceChart.yml"
      return 1
    }
  elif [[ "$actual_kind" == "object" ]]; then
    yq -e "$expr | select(tag == \"!!map\")" "$REF_FILE" >/dev/null 2>&1 || {
      echo "Type mismatch at $path_str: expected object in referenceChart.yml"
      return 1
    }
  else
    yq -e "$expr | select(tag != \"!!map\" and tag != \"!!seq\")" "$REF_FILE" >/dev/null 2>&1 || {
      echo "Type mismatch at $path_str: expected scalar in referenceChart.yml"
      return 1
    }
  fi
}

normalize_override_yaml() {
  local raw="${1:-}"
  [[ -z "$raw" ]] && { echo ""; return 0; }

  local segments=()
  split_top_level "$raw" ";" segments

  local normalized=()
  for segment in "${segments[@]}"; do
    segment="$(trim "$segment")"
    [[ -z "$segment" ]] && continue

    local parts=()
    split_top_level "$segment" "~" parts

    if [[ ${#parts[@]} -lt 2 ]]; then
      echo "Invalid override segment: $segment" >&2
      exit 1
    fi

    local value="${parts[${#parts[@]}-1]}"
    local path_parts=("${parts[@]:0:${#parts[@]}-1}")

    if [[ ${#path_parts[@]} -ge 1 ]]; then
      local resolved
      resolved="$(resolve_single_token_path "$(trim "${path_parts[0]}")")"
      local rc=$?
      if [[ $rc -eq 0 ]]; then
        local rebuilt_path_parts=()
        split_top_level "$resolved" "~" rebuilt_path_parts
        for ((idx=1; idx<${#path_parts[@]}; idx++)); do
          rebuilt_path_parts+=("${path_parts[$idx]}")
        done
        path_parts=("${rebuilt_path_parts[@]}")
      elif [[ $rc -eq 2 ]]; then
        exit 1
      elif [[ ${#path_parts[@]} -eq 1 ]]; then
        echo "Unable to resolve shorthand key '$(trim "${path_parts[0]}")'" >&2
        exit 1
      fi
    fi

    local joined=""
    for part in "${path_parts[@]}"; do
      part="$(trim "$part")"
      [[ -z "$part" ]] && continue
      if [[ -z "$joined" ]]; then
        joined="$part"
      else
        joined+="~$part"
      fi
    done

    normalized+=("${joined}~${value}")
  done

  local output=""
  for item in "${normalized[@]}"; do
    if [[ -z "$output" ]]; then
      output="$item"
    else
      output+=";$item"
    fi
  done

  printf '%s' "$output"
}

segments=()
split_top_level "$OVERRIDE_YAML" ";" segments

if [[ ${#segments[@]} -eq 0 ]]; then
  echo "No override segments found"
  exit 1
fi

for segment in "${segments[@]}"; do
  segment="$(trim "$segment")"
  [[ -z "$segment" ]] && continue

  parts=()
  split_top_level "$segment" "~" parts
  if [[ ${#parts[@]} -lt 2 ]]; then
    echo "Invalid override segment: $segment"
    exit 1
  fi

  value="$(trim "${parts[${#parts[@]}-1]}")"
  unset 'parts[${#parts[@]}-1]'

  path=""
  for part in "${parts[@]}"; do
    part="$(trim "$part")"
    if [[ -z "$path" ]]; then
      path="$part"
    else
      path+="~$part"
    fi
  done

  if [[ "$path" =~ \[.*\] ]]; then
    expanded=()
    split_top_level "$path" "~" path_tokens
    expand_list=("")
    for token in "${path_tokens[@]}"; do
      token="$(trim "$token")"
      if [[ "$token" =~ ^\[.*\]$ ]]; then
        inner="${token:1:${#token}-2}"
        split_top_level "$inner" "," inner_items
        next_expand=()
        for prefix in "${expand_list[@]}"; do
          for item in "${inner_items[@]}"; do
            item="$(trim "$item")"
            if [[ -z "$prefix" ]]; then
              next_expand+=("$item")
            else
              next_expand+=("$prefix~$item")
            fi
          done
        done
        expand_list=("${next_expand[@]}")
      else
        for i in "${!expand_list[@]}"; do
          if [[ -z "${expand_list[$i]}" ]]; then
            expand_list[$i]="$token"
          else
            expand_list[$i]+="~$token"
          fi
        done
      fi
    done
    expanded=("${expand_list[@]}")
    for exp_path in "${expanded[@]}"; do
      if parent_path="$(get_exception_parent_path "$exp_path")"; then
        validate_path_and_type "$parent_path" "{}" "false"
      else
        validate_path_and_type "$exp_path" "$value"
      fi
    done
  else
    if parent_path="$(get_exception_parent_path "$path")"; then
      validate_path_and_type "$parent_path" "{}" "false"
    else
      validate_path_and_type "$path" "$value"
    fi
  fi
done

echo "yq validation passed for OverrideYaml"

RESOLVED_OVERRIDE_YAML="$(normalize_override_yaml "$OVERRIDE_YAML")"
echo "RESOLVED_OVERRIDE_YAML=$RESOLVED_OVERRIDE_YAML" >> "$GITHUB_ENV"
echo "Resolved OverrideYaml: $RESOLVED_OVERRIDE_YAML"
