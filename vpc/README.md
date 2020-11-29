# VPC

This project defines an AWS VPC with public and private subnets for running the infrastructure in.

# FAQ

## Why is there no NAT Gateway defined

The primary reasons is to control costs. The cost of a NAT Gateway is around $40 a month.

We work around this by running the EC2 instances in the public subnet. The RDS instance is in the private subnet.

