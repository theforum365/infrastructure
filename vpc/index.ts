import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";


async function main() {
    const vpc = new awsx.ec2.Vpc(`theforum365`, {
        numberOfAvailabilityZones: 2,
        numberOfNatGateways: 0,
        cidrBlock: "172.16.0.0/24",
        subnets: [
            {type: "private", tags: {Name: "theforum365-private", tier: "production"}},
            {type: "public", tags: {Name: "theforum365-public", tier: "production"}}
        ],
        tags: {
            tier: "production",
            Name: "theforum365"
        }
    });

    return {
        vpcId: vpc.id,
        publicSubnetIds: vpc.publicSubnetIds,
        privateSubnetIds: vpc.privateSubnetIds,
        vpcCidr:"172.16.0.0/24",
    }
}

module.exports = main()
