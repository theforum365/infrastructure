import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const stackRef = new pulumi.StackReference("vpc.prod")
const vpcId = stackRef.getOutput("vpcId")
const vpcCidr = stackRef.getOutput("vpcCidr")
const privateSubnets = stackRef.getOutput("privateSubnetIds")

const security_group = new aws.ec2.SecurityGroup("theforum365-cache-securitygroup", {
    vpcId: vpcId,
    ingress: [{
        protocol: "tcp", fromPort: 6379, toPort: 6379, cidrBlocks: [vpcCidr, "172.1.0.0/16"]
    }]
})

const subnet_group = new aws.elasticache.SubnetGroup("theforum365-cache-subnetgroup",{
    subnetIds: privateSubnets,
})

const redis = new aws.elasticache.Cluster("theforum365-cache", {
    engine: "redis",
    engineVersion: "5.0.6",
    nodeType: "cache.t3.small",
    numCacheNodes: 1,
    parameterGroupName: "default.redis5.0",
    port: 6379,
    subnetGroupName: subnet_group.name,
    availabilityZone: "eu-west-1b",
    securityGroupIds: [ security_group.id ],
})
