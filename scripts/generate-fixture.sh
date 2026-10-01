#!/usr/bin/env bash

set -euo pipefail

project_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
submodule_dir="$project_dir/test/fixtures/repositories/fullstack-harjoitustyo"
work_root="$project_dir/tmp/fixture-work"

usage() {
	echo "Usage: $0 prepare <test-id>" >&2
	echo "       $0 capture <test-id> <difficulty>" >&2
	echo "" >&2
	echo "  difficulty is one of: easier, medium, harder" >&2
	exit 1
}

[[ $# -ge 2 ]] || usage

mode=$1
test_id=$2
scratch_dir="$work_root/$test_id"

case "$mode" in
prepare)
	[[ $# -eq 2 ]] || usage

	if [[ -e "$scratch_dir" ]]; then
		echo "Scratch clone already exists: $scratch_dir" >&2
		echo "Remove it or run capture first." >&2
		exit 1
	fi

	if [[ ! -d "$submodule_dir/.git" && ! -f "$submodule_dir/.git" ]]; then
		echo "Fixture repository is not a Git repository: $submodule_dir" >&2
		exit 1
	fi

	mkdir -p "$work_root"
	git clone --quiet "$submodule_dir" "$scratch_dir"

	revision=$(git -C "$submodule_dir" rev-parse HEAD)
	git -C "$scratch_dir" checkout --quiet "$revision"

	echo "Prepared scratch clone at $scratch_dir"
	echo "Revision $revision"
	echo "Edit files there, then run: $0 capture $test_id <difficulty>"
	;;
capture)
	[[ $# -eq 3 ]] || usage
	difficulty=$3

	case "$difficulty" in
	easier | medium | harder) ;;
	*)
		echo "Invalid difficulty: $difficulty" >&2
		exit 1
		;;
	esac

	if [[ ! -d "$scratch_dir" ]]; then
		echo "Missing scratch clone: $scratch_dir" >&2
		echo "Run: $0 prepare $test_id" >&2
		exit 1
	fi

	fixture_dir="$project_dir/test/fixtures/diffs/$difficulty/$test_id"
	mkdir -p "$fixture_dir"

	git -C "$scratch_dir" add -A
	git -C "$scratch_dir" diff --cached --no-color >"$fixture_dir/review.diff"

	if [[ ! -s "$fixture_dir/review.diff" ]]; then
		echo "No changes detected in the scratch clone." >&2
		exit 1
	fi

	echo "Wrote $fixture_dir/review.diff"
	echo "Changed files:"
	git -C "$scratch_dir" diff --cached --name-only

	rm -rf "$scratch_dir"
	echo "Removed scratch clone."
	;;
*)
	usage
	;;
esac
