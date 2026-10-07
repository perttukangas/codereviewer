#!/usr/bin/env bash

set -euo pipefail

project_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

usage() {
	echo "Usage: $0 <runs> [multi|single] <model...> [-- <test-id...>]" >&2
	echo "" >&2
	echo "  runs      Number of times to run the test set per model." >&2
	echo "  mode      Optional review mode. Defaults to both multi and single." >&2
	echo "  model     One or more model names (DEFAULT_MODEL_NAME values)." >&2
	echo "  test-id   Optional test ids after -- to scope the run (e.g. T01 T02)." >&2
	echo "" >&2
	echo "Example: $0 3 qwen/qwen3.6-35b-a3b openai/gpt-oss-120b" >&2
	echo "Example: $0 3 single qwen/qwen3.6-35b-a3b" >&2
	echo "Example: $0 1 qwen/qwen3.6-35b-a3b -- T01 T02" >&2
	echo "Example: $0 3 multi qwen/qwen3.6-35b-a3b openai/gpt-oss-120b -- T01 T02 T03" >&2
	echo "Example: npm run fixtures:run-all -- 3 single qwen/qwen3.6-35b-a3b -- T01 T02" >&2
	exit 1
}

[[ $# -ge 2 ]] || usage

runs=$1
shift

if [[ ! "$runs" =~ ^[0-9]+$ || "$runs" -lt 1 ]]; then
	echo "runs must be a positive integer, got: $runs" >&2
	exit 1
fi

mode_args=()
if [[ $# -gt 0 && ( "$1" == "multi" || "$1" == "single" ) ]]; then
	mode_args=("$1")
	shift
fi

models=()
test_ids=()
seen_separator=0
for arg in "$@"; do
	if [[ "$arg" == "--" ]]; then
		seen_separator=1
		continue
	fi
	if [[ "$seen_separator" -eq 1 ]]; then
		test_ids+=("$arg")
	else
		models+=("$arg")
	fi
done

if [[ ${#models[@]} -eq 0 ]]; then
	echo "At least one model is required." >&2
	usage
fi

if [[ ! -f "$project_dir/.env" ]]; then
	echo "Missing environment file: $project_dir/.env" >&2
	exit 1
fi

set -a
source "$project_dir/.env"
set +a

: "${MODEL_BASE_URL:?Set MODEL_BASE_URL to the model API base URL}"
: "${MODEL_API_KEY:?Set MODEL_API_KEY to the model API key}"

results_root="${RESULTS_ROOT:-$project_dir/test/fixtures/results}"

if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
	echo "Skipping CLI build"
else
	echo "Building the CLI once"
	npm --prefix "$project_dir" run build
fi

for model in "${models[@]}"; do
	for ((run = 1; run <= runs; run++)); do
		echo ""
		echo "============================================================"
		echo "Model $model, run $run/$runs"
		echo "============================================================"
		MODEL_NAME="$model" \
			RUN_INDEX="$run" \
			RESULTS_ROOT="$results_root" \
			SKIP_BUILD=1 \
			bash "$project_dir/scripts/run-fixtures.sh" \
				${mode_args[@]+"${mode_args[@]}"} \
				${test_ids[@]+"${test_ids[@]}"}
	done
done

echo ""
echo "All runs complete. Results written to $results_root"
echo "Next: author matches.*.json per run, then run: npm run evaluate:fixtures"
