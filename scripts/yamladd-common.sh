#!/usr/bin/env bash

split_top_level() {
  local text="$1"
  local delim="$2"
  local -n out_ref=$3
  out_ref=()

  local square=0
  local curly=0
  local paren=0
  local quote=""
  local escaped=0
  local current=""
  local ch=""

  for ((i=0; i<${#text}; i++)); do
    ch="${text:$i:1}"

    if [[ -n "$quote" ]]; then
      current+="$ch"
      if (( escaped == 1 )); then
        escaped=0
        continue
      fi
      if [[ "$ch" == "\\" ]]; then
        escaped=1
        continue
      fi
      if [[ "$ch" == "$quote" ]]; then
        quote=""
      fi
      continue
    fi

    if [[ "$ch" == '"' || "$ch" == "'" ]]; then
      quote="$ch"
      current+="$ch"
      continue
    fi

    if [[ "$ch" == "[" ]]; then
      ((square+=1))
    elif [[ "$ch" == "]" ]]; then
      ((square>0)) && ((square-=1)) || true
    elif [[ "$ch" == "{" ]]; then
      ((curly+=1))
    elif [[ "$ch" == "}" ]]; then
      ((curly>0)) && ((curly-=1)) || true
    elif [[ "$ch" == "(" ]]; then
      ((paren+=1))
    elif [[ "$ch" == ")" ]]; then
      ((paren>0)) && ((paren-=1)) || true
    fi

    if [[ "$ch" == "$delim" && $square -eq 0 && $curly -eq 0 && $paren -eq 0 ]]; then
      out_ref+=("$current")
      current=""
      continue
    fi

    current+="$ch"
  done

  if [[ -n "${current// }" ]]; then
    out_ref+=("$current")
  fi
}

trim() {
  local var="$1"
  var="${var#"${var%%[![:space:]]*}"}"
  var="${var%"${var##*[![:space:]]}"}"
  printf '%s' "$var"
}

infer_value_kind() {
  local value
  value="$(trim "$1")"
  if [[ "$value" =~ ^\[.*\]$ ]]; then
    echo "array"
  elif [[ "$value" =~ ^\{.*\}$ ]]; then
    echo "object"
  else
    echo "scalar"
  fi
}

is_exception_parent_key() {
  local key="$1"
  case "$key" in
    envSecrets|envConfig|fileConfigMap|customAppLabels|customAppAnnotations)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

resolve_single_token_path() {
  local token="$1"
  local matches=()

  local top_keys
  top_keys=$(yq -r 'keys | .[]' "$REF_FILE" 2>/dev/null)

  while IFS= read -r top_key; do
    [[ -z "$top_key" ]] && continue

    local results
    results=$(yq -r ".\"$top_key\" | .. | select(type == \"!!map\" and has(\"$token\")) | path | .[1:] + [\"$token\"] | map(tostring) | join(\"~\")" "$REF_FILE" 2>/dev/null)

    while IFS= read -r path; do
      [[ -z "$path" ]] && continue
      matches+=("${top_key}~${path}")
    done <<< "$results"
  done <<< "$top_keys"

  if [[ ${#matches[@]} -eq 0 ]]; then
    return 1
  fi

  if [[ ${#matches[@]} -eq 1 ]]; then
    printf '%s\n' "${matches[0]}"
    return 0
  fi

  echo "Ambiguous key found: '$token'." >&2
  return 2
}

get_exception_parent_path() {
  local path_str="$1"
  local path_parts=()
  split_top_level "$path_str" "~" path_parts

  local total=${#path_parts[@]}
  local acc=""

  for ((i=0; i<total; i++)); do
    local seg
    seg="$(trim "${path_parts[$i]}")"

    if [[ -z "$acc" ]]; then
      acc="$seg"
    else
      acc+="~$seg"
    fi

    if is_exception_parent_key "$seg" && (( i < total - 1 )); then
      printf '%s' "$acc"
      return 0
    fi
  done

  return 1
}
