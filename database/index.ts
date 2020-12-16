import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as random from "@pulumi/random"

/*
  Get the subnets from the VPC outputs
*/

const config = new pulumi.Config()

const adminUsers = config.requireObject<string[]>("adminUsers")

const stackRef = new pulumi.StackReference("vpc.prod")
const vpcId = stackRef.getOutput("vpcId")
const vpcCidr = stackRef.getOutput("vpcCidr")
const privateSubnets = stackRef.getOutput("privateSubnetIds")

/*
  Define a SubnetGroup with the private subnets
*/
const dbSubnetGroup = new aws.rds.SubnetGroup("theforum365-db-private", {
    subnetIds: privateSubnets,
    tags: {
        "tier": "production"
    }
})

/*
  Create a KMS key to encrypt the database with
*/
const key = new aws.kms.Key("theforum365-db-key", {
    tags: {
        "tier": "production"
    }
})

/*
 Define a security group that allows access to any IP in the VPC cidr
*/
const securityGroup = new aws.ec2.SecurityGroup("theforum365-db", {
    vpcId: vpcId,
    ingress: [{
        protocol: "tcp", fromPort: 3306, toPort: 3306, cidrBlocks: [vpcCidr, "172.1.0.0/16"]
    }]
})

/*
  Now actually define the RDS instance
  We need to generate a random password first for the admin credentials, we'll store that in
  secrets manager
*/

const adminPassword = new random.RandomPassword("theforum365-admin-password", {
    length: 14,
    special: false,
})

const db = new aws.rds.Instance("theforum365", {
    instanceClass: "db.t3.large",
    allocatedStorage: 200,
    storageType: "gp2",
    maxAllocatedStorage: 300,
    dbSubnetGroupName: dbSubnetGroup.name,
    engine: "mysql",
    engineVersion: "8.0.21",
    multiAz: false,
    availabilityZone: "eu-west-1b",
    backupRetentionPeriod: 1,
    backupWindow: "01:00-02:00",
    copyTagsToSnapshot: true,
    deleteAutomatedBackups: true,
    deletionProtection: true,
    maintenanceWindow: "Mon:02:00-Mon:05:00",
    finalSnapshotIdentifier: "theforum365-final",
    skipFinalSnapshot: true,
    vpcSecurityGroupIds: [securityGroup.id],
    tags: {
        "tier": "production",
    },
    storageEncrypted: true,
    kmsKeyId: key.arn,
    username: "admin",
    password: adminPassword.result,
})

/*
  Define an AWS secretsmanager secret
*/

const adminSecret = new aws.secretsmanager.Secret("theforum365-admin-password", {
    kmsKeyId: key.arn,
})

/*
  Define a secret policy
*/

let secretAdmins: string[] = ["arn:aws:iam::791046510159:role/ContinuousDelivery"];

for (let adminUser of adminUsers) {
    secretAdmins.push(adminUser)
}

const secretPolicy = new aws.secretsmanager.SecretPolicy("theforum365-admin-password", {
    secretArn: adminSecret.arn,
    policy: adminSecret.arn.apply(arn => JSON.stringify({
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": ["secretsmanager:DescribeSecret", "secretsmanager:List*"],
                "Principal": {"AWS": "arn:aws:iam::791046510159:root"},
                "Resource": "*"
            }, {
                "Effect": "Allow",
                "Action": ["secretsmanager:*"],
                "Principal": {"AWS": secretAdmins },
                "Resource": arn
            }]
    }))
}, { parent: adminSecret })

/*
  Now we define the secret value, which is weirdly called a secret version
*/
const adminSecretValue = new aws.secretsmanager.SecretVersion("theforum365-admin-password", {
    secretId: adminSecret.id,
    secretString: adminPassword.result,
}, { parent: adminSecret })

export const secretId = adminSecret.id

