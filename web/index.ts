import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as fs from 'fs';

const stackRef = new pulumi.StackReference("vpc.prod")
const vpcId = stackRef.getOutput("vpcId")
const vpcCidr = stackRef.getOutput("vpcCidr")
const privateSubnets = stackRef.getOutput("privateSubnets")

// Create IAM properties for ASG to function correctly
// create an IAM role
const iamRole = new aws.iam.Role(`theforum365-web-role`, {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
        Service: "ec2.amazonaws.com",
    }),
})

const managedPolicyArns: string[] = [
    'arn:aws:iam::aws:policy/AmazonEC2FullAccess',
    'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore'
]

let counter = 0;
for (const policy of managedPolicyArns) {
    // Create RolePolicyAttachment without returning it.
    const rpa = new aws.iam.RolePolicyAttachment(`$theforum365-policy-${counter++}`,
        { policyArn: policy, role: iamRole.id }, { parent: iamRole}
    );
}

const cloudwatchPolicy = new aws.iam.RolePolicy(`theforum365-cloudwatch-rp`, {
    role: iamRole.id,
    policy: {
        Version: "2012-10-17",
        Statement: [{
            Action: [
                "cloudwatch:PutMetricData",
                "ec2:DescribeVolumes",
                "ec2:DescribeTags",
                "logs:PutLogEvents",
                "logs:DescribeLogStreams",
                "logs:DescribeLogGroups",
                "logs:CreateLogStream",
                "logs:CreateLogGroup"
            ],
            Effect: "Allow",
            Resource: "*",
        }],
    },
});

const s3SoftwarePolicy = new aws.iam.RolePolicy('theforum365-s3-rp', {
    role: iamRole.id,
    policy: {
        Version: "2012-10-17",
        Statement: [{
            Action: ["s3:ListBucket"],
            Effect: "Allow",
            Resource: "arn:aws:s3:::theforum365-software",
        }, {
            Action: ["s3:GetObject",],
            Effect: "Allow",
            Resource: [ "arn:aws:s3:::theforum365-software/*"],
        }],
    }
})

const ssmRolePolicy = new aws.iam.RolePolicy("theforum365-ssm-rp", {
    role: iamRole.id,
    policy: {
        Version: "2012-10-17",
        Statement: [{
            Action: [
                "ssm:PutParameter"
            ],
            Effect: "Allow",
            Resource: "arn:aws:ssm:*:*:parameter/AmazonCloudWatch-* ",
        }],
    },
});

const instanceProfile = new aws.iam.InstanceProfile(`theforum365-web-instanceprofile`, {
    role: iamRole.name
})

const ami = pulumi.output(aws.getAmi({
    filters: [
        { name: "name", values: [ "forum-arm64*" ] }
    ],
    owners: ["791046510159"],
    mostRecent: true
}))

const instanceSecurityGroups = new aws.ec2.SecurityGroup(`theforum365-instance-securitygroup`, {
    vpcId: vpcId,
    description: "Allow all ports from same subnet",
    ingress: [{
        protocol: '-1',
        fromPort: 0,
        toPort: 0,
        cidrBlocks: [ vpcCidr ]
    }],
    egress: [{
        protocol: '-1',
        fromPort: 0,
        toPort: 0,
        cidrBlocks: ['0.0.0.0/0'],
    }]
})

// launch data
/*
let userData = Buffer.from(`}`).toString('base64');
*/

let userDataRaw = fs.readFileSync('./files/userdata.sh')
let userData = Buffer.from(userDataRaw).toString('base64')

// create a launch template with the values for our instances
const launchTemplate = new aws.ec2.LaunchTemplate(`theforum365-web-launchtemplate`, {
    imageId: ami.id,
    instanceType: "t4g.medium",
    namePrefix: "theforum365",
    networkInterfaces: [{
        deleteOnTermination: "true",
        securityGroups: [ instanceSecurityGroups.id ],
        subnetId: "subnet-063b03d0df0666b38", // // FIXME: reference this, don't hardcode it
    }],
    keyName: "forum",
    monitoring: {
        enabled: true
    },
    iamInstanceProfile: {
        arn: instanceProfile.arn
    },
    blockDeviceMappings: [{
        deviceName: "/dev/xvda",
        ebs: {
            volumeSize: 8,
            deleteOnTermination: "true",
            volumeType: "gp2",
        }
    }],
    userData: userData
})

let cloudflareIPv4: string[] = [
    "173.245.48.0/20",
    "103.21.244.0/22",
    "103.22.200.0/22",
    "103.31.4.0/22",
    "141.101.64.0/18",
    "108.162.192.0/18",
    "190.93.240.0/20",
    "188.114.96.0/20",
    "197.234.240.0/22",
    "198.41.128.0/17",
    "162.158.0.0/15",
    "104.16.0.0/12",
    "172.64.0.0/13",
    "131.0.72.0/22",
];

let cloudflareIPv6: string[] = [
    "2400:cb00::/32",
    "2606:4700::/32",
    "2803:f800::/32",
    "2405:b500::/32",
    "2405:8100::/32",
    "2a06:98c0::/29",
    "2c0f:f248::/32",
]

const webSecurityGroup = new aws.ec2.SecurityGroup(`theforum365-web-securitygroup`, {
    vpcId: vpcId,
    description: "Allow all web traffic",
    ingress: [{
        protocol: 'tcp',
        fromPort: 80,
        toPort: 80,
        // cidrBlocks: [ '0.0.0.0/0'],
        cidrBlocks: cloudflareIPv4,
        ipv6CidrBlocks: cloudflareIPv6
    }, {
        protocol: 'tcp',
        fromPort: 443,
        toPort: 443,
        // cidrBlocks: [ '0.0.0.0/0' ],
        cidrBlocks: cloudflareIPv4,
        ipv6CidrBlocks: cloudflareIPv6
    }],
    egress: [{
        protocol: '-1',
        fromPort: 0,
        toPort: 0,
        cidrBlocks: ['0.0.0.0/0'],
    }]
})

const loadbalancer = new aws.elb.LoadBalancer("theforum365-web", {
    listeners: [
        {
            instancePort: 80,
            instanceProtocol: "http",
            lbPort: 80,
            lbProtocol: "http",
        },
        {
            instancePort: 80,
            instanceProtocol: "http",
            lbPort: 443,
            lbProtocol: "https",
            sslCertificateId: "arn:aws:acm:eu-west-1:791046510159:certificate/5b4ca5df-b4df-4b6a-a128-4a1fdccfa0a1",
        },
    ],
    securityGroups: [ webSecurityGroup.id ],
    subnets: [ "subnet-063b03d0df0666b38" ], // FIXME: reference this, don't hardcode it
    healthCheck: {
        healthyThreshold: 2,
        unhealthyThreshold: 2,
        timeout: 10,
        target: "TCP:80",
        interval: 30,
    }})

const proxyProtocol = new aws.ec2.ProxyProtocolPolicy("theforum365-web", {
    loadBalancer: loadbalancer.name,
    instancePorts: [ "80", "443" ]
})

const cfnTemplate = {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'Main ASG for the forum',
    Resources: {
        "theforum365": {
            Type: 'AWS::AutoScaling::AutoScalingGroup',
            UpdatePolicy: {
                AutoScalingRollingUpdate: {
                    MaxBatchSize: "1",
                    MinInstancesInService: "1",
                    PauseTime: "PT10M",
                    // WaitOnResourceSignals: "true",
                }
            },
            Properties: {
                AvailabilityZones: [ "eu-west-1b"],
                VPCZoneIdentifier: ["subnet-063b03d0df0666b38"],
                MaxSize: 10,
                MinSize: 1,
                LoadBalancerNames: [ loadbalancer.name ],
                Cooldown: 300,
                HealthCheckType: "ELB",
                HealthCheckGracePeriod: 100,
                MixedInstancesPolicy: {
                    InstancesDistribution: {
                        OnDemandBaseCapacity: 1,
                        OnDemandPercentageAboveBaseCapacity: 50,
                    },
                    LaunchTemplate: {
                        LaunchTemplateSpecification: {
                            LaunchTemplateId: launchTemplate.id,
                            Version: launchTemplate.latestVersion,
                        },
                    }
                },
                Tags: [{
                    Key: "ManagedBy",
                    PropagateAtLaunch: true,
                    Value: "pulumi",
                }, {
                    Key: "Name",
                    PropagateAtLaunch: true,
                    Value: "theforum365-web"
                }],
            }
        }
    },
    Outputs: {
        AsgName: {
            Description: "The name of the created autoscaling group",
            Value: {
                Ref: "theforum365"
            }
        }
    }
}

const cfnAutoScalingGroup = new aws.cloudformation.Stack(`theforum365-web-cfn`, {
    templateBody: pulumi.output(cfnTemplate).apply(JSON.stringify)
}, { dependsOn: [ launchTemplate ] } )

/*
 Create an autoscaling policy, which will scale the capacity up by 1 server
 */
const scaleUp = new aws.autoscaling.Policy(`theforum365-scalingpolicy`, {
    autoscalingGroupName: cfnAutoScalingGroup.outputs.apply(x => x["AsgName"]),
    policyType: "TargetTrackingScaling",
    estimatedInstanceWarmup: 180,
    targetTrackingConfiguration: {
        predefinedMetricSpecification: {
            predefinedMetricType: "ASGAverageCPUUtilization"
        },
        targetValue: 85.0
    }
})



