import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as fs from 'fs';

const stackRef = new pulumi.StackReference("vpc.prod")
const vpcId = stackRef.getOutput("vpcId")
const vpcCidr = stackRef.getOutput("vpcCidr")
const privateSubnets = stackRef.getOutput("privateSubnets")

/*
  Create IAM properties for ASG to function correctly
*/
const iamRole = new aws.iam.Role(`theforum365-web-role`, {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
        Service: "ec2.amazonaws.com",
    }),
})

/*
  These managed policies are attached to the EC2 instances so they can do what they need to do
  FIXME: do we really need EC2 full access here?
*/
const managedPolicyArns: string[] = [
    'arn:aws:iam::aws:policy/AmazonEC2FullAccess',
    'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore'
]

/*
  Loop through the managed policies and attach
  them to the defined IAM role
*/
let counter = 0;
for (const policy of managedPolicyArns) {
    // Create RolePolicyAttachment without returning it.
    const rpa = new aws.iam.RolePolicyAttachment(`$theforum365-policy-${counter++}`,
        { policyArn: policy, role: iamRole.id }, { parent: iamRole}
    );
}

/*
  Define some custom policies for the role. This allows access to cloudwatch
  for adding metric data and logs
*/

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

/*
  This allows the ec2 instances access to the software bucket
  This is used on EC2 startup to download the forum software
  FIXME: we also need to allow access to the cdn bucket
*/

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

/*
  The role for SSM, which allows the instances to register in SSM
*/
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

/*
  This is the instance profile that gets assigned to the role
*/

const instanceProfile = new aws.iam.InstanceProfile(`theforum365-web-instanceprofile`, {
    role: iamRole.name
})

/*
  This grabs the AMI asynchronously so we can use it to pass to the launchtemplate etc
  Thw AMI is built here: https://github.com/theforum365/ami
*/
const ami = pulumi.output(aws.getAmi({
    filters: [
        { name: "name", values: [ "forum-arm64*" ] }
    ],
    owners: ["791046510159"],
    mostRecent: true
}))

/*
  Define a security group for the ec2 instances.
  We allow egress all, and we also allow access to all ports from within the VPC subnet
  We notably don't allow SSH access, because we use AWS SSM for that instead
*/

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

/*
  This defines the userdata for the instances on startup.
  We read the file async, and then convert to a Base64 string because it's clean in the metadata
*/
let userDataRaw = fs.readFileSync('./files/userdata.sh')
let userData = Buffer.from(userDataRaw).toString('base64')

/*
  This is the launch template for the instances
*/
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

/*
  List of Cloudflare IPs to pass to the loadbalancer security group
*/
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

/*
  Define a security group for the loadbalancer
  We only allow access from the cloudflare IP ranges because nobody should be hitting the loadbalancer directly
  This saves us money and stops the spambots
*/
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

/*
  The loadbalancer for the instances.
*/
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
        target: "TCP:80", // We should try use a HTTP check rather than TCP here
        interval: 30,
    }})

/*
  Enable proxy protocol on the load balancer
  This allows us to get the real IP address of the requests in the nginx access logs
*/
const proxyProtocol = new aws.ec2.ProxyProtocolPolicy("theforum365-web", {
    loadBalancer: loadbalancer.name,
    instancePorts: [ "80", "443" ]
})

/*
  We define a cloudformation template for the autoscaling group.
  The only reason we do this is because CFN allows rolling updates of the ASG when we
  make changes to the AMI. If the instance refresh API is ever merged, we should remove this.
  NOTE: this is just a standard map, so we need to use an output when we references this
  as we have a bunch of outputs in here
*/
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

/*
  Create the cloudformation stack for the autoscaling group
  As mentioned above, we take the above JSON map, stringify it and then run it through
  an output so we can resolve the promise references above
*/
const cfnAutoScalingGroup = new aws.cloudformation.Stack(`theforum365-web-cfn`, {
    templateBody: pulumi.output(cfnTemplate).apply(JSON.stringify)
}, { dependsOn: [ launchTemplate ] } )

/*
  A target tracking autoscaling policy
   We have to reference the stackouput.
   We check the CPU util of the instances in the ASG, if it hits 85%
   we scale up
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



