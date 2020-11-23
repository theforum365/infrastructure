import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

// this defines a valid VPC that can be used for EKS
const vpc = new awsx.ec2.Vpc(`theforum365`, {
    numberOfAvailabilityZones: 1,
    numberOfNatGateways: 1,
    cidrBlock: "172.16.0.0/24",
    subnets: [
        {type: "private", tags: { tier: "production" }},
        {type: "public", tags: { tier: "production" }}
    ],
    tags: {
        tier: "production",
    }
});

export const vpcId = vpc.id
export const privateSubnets = vpc.privateSubnetIds
export const publicSubnets = vpc.publicSubnetIds
