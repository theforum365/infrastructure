import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const config = new pulumi.Config()
const accountId = config.require("accountId")
const externalId = config.require("externalId")

const continuousDeliveryRole = new aws.iam.Role("ci-cd-role", {
    name: "ContinuousDelivery",
    description: "Access for CI/CD tools",
    maxSessionDuration: 2 * 60 * 60,
    assumeRolePolicy: {
        Version: "2012-10-17",
        Statement: [
            {
                Effect: "Allow",
                Principal: {
                    "AWS": `arn:aws:iam::${accountId}:root`,
                },
                Action: [
                    "sts:AssumeRole",
                ],
                Condition: {
                    "StringEquals": {
                        "sts:ExternalId": [
                            externalId,
                        ],
                    },
                }
            },
            {
                Sid: "AllowPassSessionTags",
                Effect: "Allow",
                Action: "sts:TagSession",
                Principal: {"AWS": `${accountId}`}
            }
        ],
    },
})

const continuousDeliveryPolicy = new aws.iam.Policy("ci-cd-policy", {
    description: "Access for CI/CD tools",
    policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
            {
                "Sid": "AdministratorAccess",
                "Effect": "Allow",
                "Action": "*",
                "Resource": "*",
            },
            {
                Sid: "DenyPermissionEscalation",
                Effect: "Deny",
                Action: [
                    "iam:CreateAccessKey",
                    "iam:CreateLoginProfile",
                    "iam:UpdateLoginProfile",
                    "iam:AttachUserPolicy",
                    "iam:AddUserToGroup",
                    "iam:UpdateAssumeRolePolicy",
                ],
                Resource: "*",
            },
            {
                Sid: "DenyManagingAccountAccess",
                Effect: "Deny",
                Action: [
                    // Users
                    "iam:CreateUser",
                    "iam:UpdateUser",
                    "iam:DeleteUser",
                    "iam:ChangePassword",
                    "iam:CreateGroup",
                    "iam:UpdateGroup",
                    "iam:DeleteGroup",
                    "iam:AddUserToGroup",
                    "iam:RemoveUserFromGroup",
                    "iam:CreateAccountAlias",
                    "iam:UpdateAccountPasswordPolicy",
                    "iam:SetSecurityTokenServicePreferences",
                    "iam:CreateVirtualMFADevice",
                    "iam:EnableMFADevice",
                    "iam:ResyncMFADevice",
                    "iam:AddClientIDToOpenIDConnectProvider",
                    "iam:UpdateOpenIDConnectProviderThumbprint",
                    "iam:RemoveClientIDFromOpenIDConnectProvider",
                ],
                "Resource": "*",
            },
        ],
    })
}, { parent: continuousDeliveryRole})

const continuousDeliveryPolicyAttachment = new aws.iam.PolicyAttachment("ci-cd-policyattachment", {
    policyArn: continuousDeliveryPolicy.arn,
    roles: [ continuousDeliveryRole.name ],
})

const ghaUser = new aws.iam.User("github-actions")

const ghaUserPolicy = new aws.iam.Policy("github-actions", {
    policy: continuousDeliveryRole.arn.apply(arn => JSON.stringify({
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Action": [
                "sts:AssumeRole",
                "sts:TagSession",
            ],
            "Resource": arn,
        }]
    }))

})

const attachment = new aws.iam.UserPolicyAttachment("github-actions", {
    policyArn: ghaUserPolicy.arn,
    user: ghaUser.name
}, { parent: ghaUserPolicy })

