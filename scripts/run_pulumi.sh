#!/bin/bash

pulumi login s3://pulumi-state-f365
PULUMI_COMMAND="pulumi $*"

OUTPUT_FILE=$(mktemp)
echo "#### :tropical_drink: \`$PULUMI_COMMAND\`"
bash -c "$PULUMI_COMMAND" | tee $OUTPUT_FILE
EXIT_CODE=${PIPESTATUS[0]}

# If the GitHub action stems from a Pull Request event, we may optionally leave a comment if the
# COMMENT_ON_PR is set.
COMMENTS_URL=$(cat $GITHUB_EVENT_PATH | jq -r .pull_request.comments_url)
if [ ! -z $COMMENTS_URL ] && [ ! -z $COMMENT_ON_PR ]; then
    if [ -z $GITHUB_TOKEN ]; then
        echo "ERROR: COMMENT_ON_PR was set, but GITHUB_TOKEN is not set."
    else
        COMMENT="#### :tropical_drink: \`$PULUMI_COMMAND\`
\`\`\`
$(cat $OUTPUT_FILE)
\`\`\`"
        PAYLOAD=$(echo '{}' | jq --arg body "$COMMENT" '.body = $body')
        echo "Commenting on PR $COMMENTS_URL"
        curl -s -S -H "Authorization: token $GITHUB_TOKEN" -H "Content-Type: application/json" --data "$PAYLOAD" "$COMMENTS_URL"
    fi
fi
