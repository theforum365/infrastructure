# Infrastructure

This repo contains all of the code that defines the infrastructure for [theforum365](https://theforum365.com).

It consists of [Infrastructure as Code](https://en.wikipedia.org/wiki/Infrastructure_as_code) definitions for running an [Invision Community](https://invisioncommunity.com/)
forum on [Amazon Web Services](https://aws.amazon.com/).

The infrastructure is defined using [Pulumi](https://pulumi.com/) using their [TypeScript](https://www.typescriptlang.org/) SDK.

## Getting Started

Each directory is a Pulumi project, managing different parts of the required infrastructure:

| Directory | Information |
| ------------- | ------------- |
| [VPC](./vpc/README.md)  | Defines a best practice VPC with public and private subnets |
| [Software](./software/README.md)  | Defines an S3 bucket for storing the forum's PHP software | 
| [Web](./web/README.md) | Defines the resources needed to run the web tier, such as the ELB and EC2 instance |
| [Database](./database/README.md) | Defines the RDS database backing the forum |
| [Elasticache](./elasticache/README.md) | Defines the Redis cache used for session storage |
| [CICD](./cicd/README.md) | Defines some IAM roles and functionality for running the software in a Github Actions pipeline |

## Contributing

If you find a mistake, or would like to add some functionality, please fork this repo and create a [Pull Request](https://docs.github.com/en/free-pro-team@latest/github/collaborating-with-issues-and-pull-requests/about-pull-requests)

 

