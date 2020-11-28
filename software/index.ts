import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";


const key = new aws.kms.Key("forum-software", {
    description: "Used to encrypt bucket storing forum software",
    deletionWindowInDays: 10,
})

// Create an AWS resource (S3 Bucket)
const bucket = new aws.s3.Bucket("software", {
    bucket: "theforum365-software",
    serverSideEncryptionConfiguration: {
        rule: {
            applyServerSideEncryptionByDefault: {
                kmsMasterKeyId: key.arn,
                sseAlgorithm: "aws:kms",
            },
        },
    },
});

// Export the name of the bucket
export const bucketName = bucket.id;
