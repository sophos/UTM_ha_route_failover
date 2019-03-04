import boto3
import logging
from time import sleep

logger = logging.getLogger()
logger.setLevel(logging.INFO)

AWS_ACCESS_KEY = ''
AWS_SECRET_KEY = '+gigr'
AWS_REGION = '' # e.g. eu-west-1
ELASTIC_IP_ALLOC_ID = ''  # e.g. eipalloc-d5626fdef
ROUTE_TABLE_IDS = ['']  # e.g. ['rtb-b9455ddc', 'rtb-c1116eed']


def get_eip_assignment(ec2_client):
    logger.info("Describing EIP with Allocation ID '{}'".format(ELASTIC_IP_ALLOC_ID))
    filters = [
        {'Name': 'allocation-id', 'Values': [ELASTIC_IP_ALLOC_ID]}
    ]
    response = ec2_client.describe_addresses(Filters=filters)
    logger.debug("Response: {}".format(response))
    try:
        associated_eni = response['Addresses'][0].get('NetworkInterfaceId')
    except KeyError:
        logger.exception("Unable to find EIP")
    else:
        if associated_eni is not None:
            logger.info("Associated ENI: {}".format(associated_eni))
        else:
            error_message = "No ENI associated with EIP '{}'".format(ELASTIC_IP_ALLOC_ID)
            logger.error(error_message)
            raise ValueError(error_message)
        return associated_eni


def get_route_table(route_table_id):
    logger.info("Getting Route Table Resource for '{}'".format(route_table_id))
    try:
        ec2 = boto3.resource(
            'ec2',
            aws_access_key_id=AWS_ACCESS_KEY,
            aws_secret_access_key=AWS_SECRET_KEY,
            region_name=AWS_REGION
        )
        route_table_resource = ec2.RouteTable(route_table_id)
    except Exception:
        logger.exception("Could not get Route Table Resource for Route Table '{}'".format(route_table_id))
        raise
    else:
        return route_table_resource


def get_blackhole_routes(route_table_resource):
    logger.info('Getting Blackhole Routes')
    blackhole_routes = [route for route in route_table_resource.routes_attribute if route.get('State') == 'blackhole']

    for route in blackhole_routes:
        logger.info("Blackhole Route: {}".format(route))

    return blackhole_routes


def update_blackhole_route(route_table_id, route, eni):
    destination_cidr = route.get('DestinationCidrBlock')
    if destination_cidr is None:
        logger.warn("No CIDR Block defined for Route: {}".format(route))
        return False

    try:
        ec2 = boto3.resource(
            'ec2',
            aws_access_key_id=AWS_ACCESS_KEY,
            aws_secret_access_key=AWS_SECRET_KEY,
            region_name=AWS_REGION
        )
        route_resource = ec2.Route(route_table_id, destination_cidr)
    except:
        logger.exception("Could not get route resource for Route '{}' in Route Table '{}'".format(
            destination_cidr,
            route_table_id
        ))
        return False

    logger.info("Updating Route '{}' for Route Table '{}'...".format(
        destination_cidr,
        route_table_id
    ))

    try:
        route_resource.replace(
            DryRun=False,
            NetworkInterfaceId=eni
        )
    except:
        logger.exception("Could not update Route '{}' for Route Table '{}'...".format(
            destination_cidr,
            route_table_id
        ))
        return False

    logger.info("Route '{}' for Route Table '{}' updated".format(
        destination_cidr,
        route_table_id
    ))

    return True


def get_ec2_client():
    client = boto3.client(
        'ec2',
        aws_access_key_id=AWS_ACCESS_KEY,
        aws_secret_access_key=AWS_SECRET_KEY,
        region_name=AWS_REGION
    )
    return client


def main(event, context):
    logger.info("Starting Script...")

    ec2_client = get_ec2_client()
    eni = get_eip_assignment(ec2_client)

    update_error_count = 0
    for route_table_id in ROUTE_TABLE_IDS:
        route_table_client = get_route_table(route_table_id)
        blackhole_routes = get_blackhole_routes(route_table_client)
        for blackhole_route in blackhole_routes:
            success = update_blackhole_route(
                route_table_id=route_table_id,
                route=blackhole_route,
                eni=eni
            )

            if success is False:
                update_error_count += 1

    if update_error_count == 0:
        complete_message = "Finished script with {} errors".format(update_error_count)
        logger.info(complete_message)
    else:
        complete_message = "Finished script with {} errors".format(update_error_count)
        logger.warn(complete_message)

    return {
        "CompleteMessage": complete_message,
        "NumberOfErrors": update_error_count
    }
