#!/usr/bin/env bash

set -euo pipefail

: "${OVERRIDE_YAML:?OVERRIDE_YAML is required}"
: "${REF_FILE:?REF_FILE is required}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/yamladd-common.sh"

print_schema_help() {
  echo "   Check the schema in repo 'disc-fe-discover-devops-utlilities/referenceChart.yml' or reach out to swatdevops."
}

echo "=== Fuzzy Matching Suggestions ==="

segments=()
split_top_level "$OVERRIDE_YAML" ";" segments

for segment in "${segments[@]}"; do
  segment="$(trim "$segment")"
  [[ -z "$segment" ]] && continue

  parts=()
  split_top_level "$segment" "~" parts

  value="$(trim "${parts[${#parts[@]}-1]}")"
  unset 'parts[${#parts[@]}-1]'

  path_str=""
  for part in "${parts[@]}"; do
    part="$(trim "$part")"
    if [[ -z "$path_str" ]]; then
      path_str="$part"
    else
      path_str+="~$part"
    fi
  done

  resolved_first=""
  resolve_rc=0

  path_parts=()
  split_top_level "$path_str" "~" path_parts
  first="$(trim "${path_parts[0]}")"

  if [[ "$path_str" != *"["* ]]; then
    if resolved_first="$(resolve_single_token_path "$first")"; then
      rebuilt_path_parts=()
      split_top_level "$resolved_first" "~" rebuilt_path_parts
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

      path_parts=()
      split_top_level "$path_str" "~" path_parts
      first="$(trim "${path_parts[0]}")"
    else
      resolve_rc=$?
      if [[ $resolve_rc -eq 2 ]]; then
        exit 1
      fi
    fi
  fi

  if [[ $resolve_rc -eq 2 ]]; then
    exit 1
  fi

  path_parts=()
  split_top_level "$path_str" "~" path_parts

  first="$(trim "${path_parts[0]}")"

  if ! yq -e ".. | select(type == \"!!map\" and has(\"$first\")) | .\"$first\"" "$REF_FILE" >/dev/null 2>&1; then
    echo ""
    echo "❌ Invalid path: $path_str"
    echo "   Parent key '$first' not found in referenceChart.yml"

    all_keys="$(yq -r '.. | select(tag == "!!map") | keys | .[]' "$REF_FILE" 2>/dev/null | sort -u)"

    if [[ -n "$all_keys" ]]; then
      input_lower="$(echo "$first" | tr '[:upper:]' '[:lower:]')"
      input_len=${#input_lower}
      fuzzy_results=""

      for ((len=1; len<=input_len; len++)); do
        substring="${input_lower:0:$len}"
        if [[ -n "$fuzzy_results" ]]; then
          break
        fi
        while IFS= read -r key; do
          [[ -z "$key" ]] && continue
          key_lower="$(echo "$key" | tr '[:upper:]' '[:lower:]')"
          if [[ "$key_lower" == "$substring"* ]]; then
            [[ -n "$fuzzy_results" ]] && fuzzy_results+=",$key" || fuzzy_results="$key"
          fi
        done <<< "$all_keys"
      done

      if [[ -z "$fuzzy_results" ]]; then
        while IFS= read -r key; do
          [[ -z "$key" ]] && continue
          key_lower="$(echo "$key" | tr '[:upper:]' '[:lower:]')"
          if [[ "$key_lower" == *"$input_lower"* ]]; then
            [[ -n "$fuzzy_results" ]] && fuzzy_results+=",$key" || fuzzy_results="$key"
          fi
        done <<< "$all_keys"
      fi

      if [[ -n "$fuzzy_results" ]]; then
        echo "   💡 Did you mean? $fuzzy_results"
        print_schema_help
      fi
    fi
  else
    expr=".. | select(type == \"!!map\" and has(\"$first\")) | .\"$first\""

    for ((p=1; p<${#path_parts[@]}; p++)); do
      seg="$(trim "${path_parts[$p]}")"
      next_expr="$expr | select(type == \"!!map\" and has(\"$seg\")) | .\"$seg\""

      if ! yq -e "$next_expr | select(. != null)" "$REF_FILE" >/dev/null 2>&1; then
        if yq -e "$expr | select(tag != \"!!map\" and tag != \"!!seq\")" "$REF_FILE" >/dev/null 2>&1; then
          echo ""
          expected_value="$(yq -r "$expr" "$REF_FILE" 2>/dev/null)"
          echo "❌ Key '${seg}' is not valid under '${path_parts[$((p-1))]}'"
          if [[ -n "$expected_value" && "$expected_value" != "null" ]]; then
            echo "   Expected example: ${path_parts[$((p-1))]}~${expected_value}"
          else
            echo "   Expected scalar value under '${path_parts[$((p-1))]}'"
          fi
          print_schema_help
          break
        fi

        echo ""
        echo "❌ Invalid path: $path_str"
        echo "   Child key '$seg' not found under '${path_parts[$((p-1))]}'."

        parent_key="${path_parts[$((p-1))]}"
        parent_children="$(yq -r "$expr | select(tag == \"!!map\") | keys | .[]" "$REF_FILE" 2>/dev/null)"

        if [[ -n "$parent_children" ]]; then
          expected_children="$(printf '%s\n' "$parent_children" | tr '\n' ',' | sed 's/,$//')"
          if [[ "$expected_children" == "enabled" ]]; then
            echo "   Expected child key is enabled under '$parent_key'"
            echo "   Example path: ${path_parts[0]}~$parent_key~enabled"
          else
            echo "   Expected key(s) under '$parent_key': $expected_children"
          fi

          input_lower="$(echo "$seg" | tr '[:upper:]' '[:lower:]')"
          input_len=${#input_lower}
          fuzzy_results=""

          for ((len=1; len<=input_len; len++)); do
            substring="${input_lower:0:$len}"
            if [[ -n "$fuzzy_results" ]]; then
              break
            fi
            while IFS= read -r child; do
              [[ -z "$child" ]] && continue
              child_lower="$(echo "$child" | tr '[:upper:]' '[:lower:]')"
              if [[ "$child_lower" == "$substring"* ]]; then
                [[ -n "$fuzzy_results" ]] && fuzzy_results+=",$child" || fuzzy_results="$child"
              fi
            done <<< "$parent_children"
          done

          if [[ -z "$fuzzy_results" ]]; then
            while IFS= read -r child; do
              [[ -z "$child" ]] && continue
              child_lower="$(echo "$child" | tr '[:upper:]' '[:lower:]')"
              if [[ "$child_lower" == *"$input_lower"* ]]; then
                [[ -n "$fuzzy_results" ]] && fuzzy_results+=",$child" || fuzzy_results="$child"
              fi
            done <<< "$parent_children"
          fi

          if [[ -n "$fuzzy_results" ]]; then
            echo "   💡 Did you mean? $fuzzy_results"
            print_schema_help
          fi
        fi
        break
      fi

      expr="$next_expr"
    done
  fi
done

exit 1
