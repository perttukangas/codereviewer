#!/usr/bin/env bash

set -euo pipefail

project_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
submodule_dir="$project_dir/test/fixtures/repositories/fullstack-harjoitustyo"
work_root="$project_dir/tmp/fixture-work"
results_root="$project_dir/test/fixtures/results"
diffs_root="$project_dir/test/fixtures/diffs"

if [[ ! -f "$project_dir/.env" ]]; then
	echo "Missing environment file: $project_dir/.env" >&2
	exit 1
fi

set -a
source "$project_dir/.env"
set +a

: "${MODEL_BASE_URL:?Set MODEL_BASE_URL to the model API base URL}"
: "${MODEL_API_KEY:?Set MODEL_API_KEY to the model API key}"
: "${DEFAULT_MODEL_NAME:?Set DEFAULT_MODEL_NAME to the model name}"

# In single mode the generalist reviewer and its verifier each cover the work of
# the five specialized review agents, so scale their guardrail budgets and
# timeout by the number of specialized agents. Values derive from the effective
# defaults so a .env override is respected.
single_mode_multiplier=5
single_input_token_budget=$(( ${DEFAULT_INPUT_TOKEN_BUDGET:-96000} * single_mode_multiplier ))
single_output_token_budget=$(( ${DEFAULT_OUTPUT_TOKEN_BUDGET:-32000} * single_mode_multiplier ))
single_timeout_ms=$(( ${DEFAULT_TIMEOUT_MS:-300000} * single_mode_multiplier ))

echo "Building the CLI"
npm --prefix "$project_dir" run build

modes=(multi single)
if [[ $# -gt 0 && ( "$1" == "multi" || "$1" == "single" ) ]]; then
	modes=("$1")
	shift
fi

if [[ $# -gt 0 ]]; then
	test_ids=("$@")
else
	mapfile -t test_ids < <(
		find "$diffs_root" -mindepth 2 -maxdepth 2 -type d -name 'T*' -printf '%f\n' | sort
	)
fi

if [[ ${#test_ids[@]} -eq 0 ]]; then
	echo "No tests found under $diffs_root" >&2
	exit 1
fi

for test_id in "${test_ids[@]}"; do
	manifest=$(find "$diffs_root" -mindepth 3 -maxdepth 3 -path "*/$test_id/manifest.json" | head -n 1)
	if [[ -z "$manifest" ]]; then
		echo "No manifest for $test_id, skipping." >&2
		continue
	fi

	fixture_dir=$(dirname "$manifest")
	diff_path="$fixture_dir/review.diff"
	if [[ ! -f "$diff_path" ]]; then
		echo "No diff for $test_id, skipping." >&2
		continue
	fi

	result_dir="$results_root/$test_id"
	mkdir -p "$result_dir"

	for mode in "${modes[@]}"; do
		scratch_dir="$work_root/$test_id"
		rm -rf "$scratch_dir"
		mkdir -p "$work_root"

		git clone --quiet "$submodule_dir" "$scratch_dir"
		revision=$(git -C "$submodule_dir" rev-parse HEAD)
		git -C "$scratch_dir" checkout --quiet "$revision"
		git -C "$scratch_dir" apply --ignore-space-change --ignore-whitespace "$diff_path"

		log_dir="$result_dir/logs.$mode"

		rm -rf "$log_dir"
		rm -f "$result_dir/report.$mode.json" "$result_dir/matches.$mode.json"

		mode_env=()
		if [[ "$mode" == "single" ]]; then
			mode_env+=(
				"GENERALIST_INPUT_TOKEN_BUDGET=$single_input_token_budget"
				"GENERALIST_OUTPUT_TOKEN_BUDGET=$single_output_token_budget"
				"GENERALIST_TIMEOUT_MS=$single_timeout_ms"
				"VERIFIER_INPUT_TOKEN_BUDGET=$single_input_token_budget"
				"VERIFIER_OUTPUT_TOKEN_BUDGET=$single_output_token_budget"
				"VERIFIER_TIMEOUT_MS=$single_timeout_ms"
			)
		fi

		echo "Running $mode review for $test_id"
		env \
			REPO_DIR="$scratch_dir" \
			GIT_DIFF_PATH="$diff_path" \
			REVIEW_MODE="$mode" \
			LOG_DIR="${LOG_DIR:-$log_dir}" \
			${mode_env[@]+"${mode_env[@]}"} \
			node "$project_dir/dist/index.js" review --output "$result_dir/report.$mode.json"

		rm -rf "$scratch_dir"
	done
done

echo "Done. Reports written to $results_root"
