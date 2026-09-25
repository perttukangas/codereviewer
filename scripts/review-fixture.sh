#!/usr/bin/env bash

set -euo pipefail

project_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
input_dir=${1:-"$project_dir/test/fixtures/diffs/fullstack-harjoitustyo"}
repository_dir=${2:-"$project_dir/test/fixtures/repositories/fullstack-harjoitustyo"}

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

container_name="codereviewer-fixture-$$"
container_log_path=${LOG_FILE:-/tmp/codereviewer.log}
host_log_path="$project_dir/tmp/codereviewer.log"

if [[ ! -d "$input_dir" ]]; then
	echo "Missing fixture input directory: $input_dir" >&2
	exit 1
fi

if [[ ! -d "$repository_dir" ]]; then
	echo "Missing repository directory: $repository_dir" >&2
	exit 1
fi

input_dir=$(cd "$input_dir" && pwd)
repository_dir=$(cd "$repository_dir" && pwd)
diff_path="$input_dir/review.diff"

if [[ ! -f "$diff_path" ]]; then
	echo "Missing fixture diff: $diff_path" >&2
	exit 1
fi

if ! git -C "$repository_dir" rev-parse --show-toplevel >/dev/null 2>&1; then
	echo "Fixture repository is not a Git repository: $repository_dir" >&2
	exit 1
fi

if [[ -n "$(git -C "$repository_dir" status --porcelain)" ]]; then
	echo "Fixture repository must be clean before applying the review diff." >&2
	exit 1
fi

repository_revision=$(git -C "$repository_dir" rev-parse HEAD)
git -C "$repository_dir" apply --check --ignore-space-change --ignore-whitespace "$diff_path"
git -C "$repository_dir" apply --ignore-space-change --ignore-whitespace "$diff_path"

restore_repository() {
	local exit_code=$?
	trap - EXIT INT TERM

	if docker cp "$container_name:$container_log_path" "$host_log_path" >/dev/null 2>&1; then
		echo "Copied container logs to $host_log_path"
	fi
	docker rm -f "$container_name" >/dev/null 2>&1 || true

	if ! git -C "$repository_dir" restore --source "$repository_revision" --worktree --staged -- .; then
		echo "Failed to restore fixture repository: $repository_dir" >&2
		exit 1
	fi
	if [[ -n "$(git -C "$repository_dir" status --porcelain)" ]]; then
		echo "Fixture repository is not clean after restoration: $repository_dir" >&2
		exit 1
	fi

	exit "$exit_code"
}

trap restore_repository EXIT INT TERM

container_user_uid=1000

if ! command -v setfacl >/dev/null 2>&1; then
	echo "Missing required command: setfacl" >&2
	exit 1
fi

find "$repository_dir" "$input_dir" -type d \
	-exec setfacl -m "u:${container_user_uid}:rx" {} +
find "$repository_dir" "$input_dir" -type f \
	-exec setfacl -m "u:${container_user_uid}:r" {} +

docker build --tag codereviewer:local "$project_dir"

mkdir -p "$project_dir/tmp"

docker run --name "$container_name" \
	--mount "type=bind,src=$repository_dir,dst=/workspace/repository,readonly" \
	--mount "type=bind,src=$input_dir,dst=/workspace/input,readonly" \
	--env-file "$project_dir/.env" \
	--env REPO_DIR=/workspace/repository \
	--env GIT_DIFF_PATH=/workspace/input/review.diff \
	--env LOG_FILE="$container_log_path" \
	codereviewer:local
