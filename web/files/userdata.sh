#!/bin/bash

# Build some variables for later

HEALTHCHECK_URI="http://localhost/php_fpm_status"
STACK_NAME=$(aws ec2 describe-instances --instance-id $(curl -s http://169.254.169.254/latest/dynamic/instance-identity/document | jq .instanceId -r) --region eu-west-1 --query "Reservations[*].Instances[*].Tags[?Key=='aws:cloudformation:stack-name'].Value" --output text)
REGION=$(curl -s http://169.254.169.254/latest/dynamic/instance-identity/document | jq .region -r)
ASG_NAME=$(aws ec2 describe-instances --instance-id $(curl -s http://169.254.169.254/latest/dynamic/instance-identity/document | jq .instanceId -r) --region eu-west-1 --query "Reservations[*].Instances[*].Tags[?Key=='aws:autoscaling:groupName'].Value" --output text)

# This installs the forum software
# FIXME: fix the harcoding here, we should be able to retrieve the software version
# from a variable
aws s3 sync s3://theforum365-software/4.4.10 /srv/http/theforum365.com/root/html/ --sse
chown -R nginx:nginx /srv/http/theforum365.com

# create template path
mkdir -p /srv/http/theforum365.com/root/html/uploads/templates
chown nginx:nginx /srv/http/theforum365.com/root/html/uploads/templates

# Check if nginx comes up
printf "Waiting for nginx to be ready"
until $(curl -k --output /dev/null --silent --head --fail --max-time 2 ${HEALTHCHECK_URI}); do
    printf '.'
    sleep 2
done
echo
echo "nginx is ready!"
echo "sending cfn-signal"
# sends a signal to cloudformation informing it that the instance is healthy
/opt/aws/bin/cfn-signal --resource ${ASG_NAME} --stack ${STACK_NAME} --region ${REGION}
