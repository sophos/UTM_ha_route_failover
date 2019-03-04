/*
Lambda Node.js Script.
Lambda Function: Sophos-Fix-BlackHole-Route
Script Name: Sophos.js
Scripter: Greg Wright
Script Written: March 2016
Modules: async, aws-sdk
Purpose:
1. Loop through the Route Tables defined by objRouteTables.
2. Get the status of the Route 0.0.0.0 in the Route Table.
3. Get the Queen UTM in the same VPC as the Route Table and update the Name Tag if needed.
4. Get the Worker UTM in the same VPC as the Route Table and update the Name Tag if needed.
5. If the Route 0.0.0.0 is missing in the Route Table create it pointing it to the Queen UTM in that VPC.
6. If the Route 0.0.0.0 is in a State of Black Hole replace the route pointing it to the Queen UTM in that VPC.
Note: To test this script in a Node.js Command Prompt on a Windows desktop comment out the lines
that have //**** COMMENT OUT FOR TESTING **** after them.
*/

// nmp install standard -g standard used to verify script style
var AWS = require('aws-sdk')
AWS.config.region = 'us-east-1'
var async = require('async')

// the 'handler' that lambda calls to execute our code
exports.handler = function (event, context) { // **** COMMENT OUT FOR TESTING ****
  var ec2 = new AWS.EC2()
  var EmailBody = null
  var RouteTables = ['rtb-xxxx’, 'rtb-xxxxxx’]
  var ses = new AWS.SES({apiVersion: '2010-12-01'})
  var to = ['awsadmins@test.com']
  var from = 'awsadmins@test.com'
  ses.sendEmail({
    Source: from,
    Destination: { ToAddresses: to },
    Message: {
      Subject: { Data: 'Sophos Lambda Script Fired.' },
      Body: {
        Text: {
          Data: 'The Sophos Lambda script fired. Another email will be sent on completion.'
        }
      }
    }
  }, function (err, data) {
    if (err) throw err
  })

  EmailBody += 'async.eachSeries loop begin.\r\n'
  console.log('async.eachSeries loop begin.')
  EmailBody += '----------------------Start------------------------\r\n'
  console.log('----------------------Start------------------------')

  async.eachSeries(Object.keys(RouteTables), function (item, nextWaterfall) {
    async.waterfall(
      [

    // For each Route Table in RouteTables ride the WaterFall. (each function calls the next, dont change the order.)
    // Note: Script gets the Route Table, Queen UTM and Worker UTM's and passes those objects at a minimum to the next function.
    // Note: Any error stops (we dont issue the callback) the script completely and the Waterfall ride is over for everyone.

  // --- Get a Route Table from the RouteTables Id's eachSeries Loop.
        function GetRouteTable (GetQueenUTM) {
          var params = { RouteTableIds: [ RouteTables[item] ] }
          ec2.describeRouteTables(params, function (err, data) {
            if (err) {
              console.log(err) // Display error, no callback, waterfall over.
            } else {
              console.log('Route Table: ' + RouteTables[item])
              EmailBody += 'Route Table: ' + RouteTables[item] + '\r\n'
              GetQueenUTM(null, data.RouteTables[0]) // Next Function.
            }
          })
        },

  // --- Get the Queen UTM in the same VPC as the Route Table.
        function GetQueenUTM (RouteTable, GetWorkerUTMs) {
          var params = {
            Filters: [
              { Name: 'tag:Name', Values: ['*Queen*'] },
              { Name: 'vpc-id', Values: [RouteTable.VpcId] }
            ]
          }
          ec2.describeInstances(params, function (err, data) {
            if (err) {
              console.log(err) // Display error, no callback, waterfall over.
            } else {
              GetWorkerUTMs(null, RouteTable, data.Reservations[0].Instances[0])  // Next Function.
            }
          })
        },

  // --- Get the Work UTM's in the same VPC as the Route Table.
        function GetWorkerUTMs (RouteTable, QueenInstance, GetRouteZeroState) {
          var params = {
            Filters: [
              { Name: 'tag:Name', Values: ['*Worker UTM*'] },
              { Name: 'vpc-id', Values: [RouteTable.VpcId] }
            ]
          }
          ec2.describeInstances(params, function (err, data) {
            if (err) {
              console.log(err) // Display error, no callback, waterfall over.
            } else {
              GetRouteZeroState(null, RouteTable, QueenInstance, data.Reservations) // Next Function.
            }
          })
        },

  // --- Find Route 0.0.0.0/0 State in RouteTable.
        function GetRouteZeroState (RouteTable, QueenInstance, Workers, FixRoute) {
          var index = 0
          var RouteZeroState = null
          async.each(RouteTable.Routes, function (Route) {
            index++
            if (Route.DestinationCidrBlock === '0.0.0.0/0') {
              if (Route.State === 'blackhole') { RouteZeroState = 'blackhole' }
              if (Route.State === 'active') { RouteZeroState = 'active' }
            }
            if (index === RouteTable.Routes.length) { // Last item in array, time to call next function.
              if (RouteZeroState !== 'blackhole' && RouteZeroState !== 'active') { RouteZeroState = 'missing' }
              FixRoute(null, RouteTable, QueenInstance, Workers, RouteZeroState) // Next Function.
            }
          })
        },

  // --- Based on the Route 0.0.0.0/0 State fix the Route if neccessary.
        function FixRoute (RouteTable, QueenInstance, Workers, RouteZeroState, GetEnvironmentLevel) {
          var params = { DestinationCidrBlock: '0.0.0.0/0', RouteTableId: RouteTable.RouteTableId, NetworkInterfaceId: QueenInstance.NetworkInterfaces[0].NetworkInterfaceId }
          if (RouteZeroState === 'missing') {
            EmailBody += 'Route 0.0.0.0/0 Created for Eni:' + QueenInstance.NetworkInterfaces[0].NetworkInterfaceId + '\r\n'
            console.log('Route 0.0.0.0/0 Created for Eni:' + QueenInstance.NetworkInterfaces[0].NetworkInterfaceId)
            ec2.createRoute(params, function (err, data) {
              if (err) { // Display error, no callback, waterfall over.
                console.log(err)
              } else {
                GetEnvironmentLevel(null, RouteTable, QueenInstance, Workers) // Next Function.
              }
            })
          } else if (RouteZeroState === 'blackhole') {
            EmailBody += 'Route 0.0.0.0/0 Replaced for Eni:' + QueenInstance.NetworkInterfaces[0].NetworkInterfaceId + '\r\n'
            console.log('Route 0.0.0.0/0 Replaced for Eni:' + QueenInstance.NetworkInterfaces[0].NetworkInterfaceId)
            ec2.replaceRoute(params, function (err, data) {
              if (err) { // Display error, no callback, waterfall over.
                console.log(err)
              } else {
                GetEnvironmentLevel(null, RouteTable, QueenInstance, Workers) // Next Function.
              }
            })
          } else if (RouteZeroState === 'active') {
            EmailBody += 'Route 0.0.0.0/0 Active - No Change \r\n'
            console.log('Route 0.0.0.0/0 Active - No Change')
            GetEnvironmentLevel(null, RouteTable, QueenInstance, Workers) // Next Function.
          }
        },

  // --- Get the Environment Level (L0,L1,L2,L3,L4,L5) from the Queen Instance aws:cloudformation:stack-name Tag.
        function GetEnvironmentLevel (RouteTable, QueenInstance, Workers, FixQueenUTMName) {
          var params = {
            Filters: [
              { Name: 'resource-id', Values: [QueenInstance.InstanceId] },
              { Name: 'key', Values: ['aws:cloudformation:stack-name'] }
            ]
          }
          ec2.describeTags(params, function (err, data) {
            if (err) {
              console.log(err) // Display error, no callback, waterfall over.
            } else {
              var LLevel = data.Tags[0].Value.substring(0, 2)
              if (LLevel.match('[L][0-5]')) {
                var EnvironmentLevel = LLevel
                EmailBody += 'Environment: ' + EnvironmentLevel + '\r\n'
                console.log('Environment: ' + EnvironmentLevel)
                FixQueenUTMName(null, RouteTable, QueenInstance, Workers, EnvironmentLevel) // Next Function.
              } else {
                EmailBody += 'No Environment Found on Queen cloudformation:stack-name Tag \r\n'
                console.log('No Environment Found on Queen cloudformation:stack-name Tag') // Display issue, no callback, waterfall over.
              }
            }
          })
        },

  // --- Change the Queen Name Tag.  'Queen UTM' becomes 'L0 Queen UTM' for example.
        function FixQueenUTMName (RouteTable, QueenInstance, Workers, EnvironmentLevel, FixWorkerUTMNames) {
          var params = {
            Filters: [
              { Name: 'resource-id', Values: [QueenInstance.InstanceId] },
              { Name: 'key', Values: ['Name'] }
            ]
          }
          ec2.describeTags(params, function (err, data) {
            if (err) {
              console.log(err) // Display error, no callback, waterfall over.
            } else {
              var LLevel = data.Tags[0].Value.substring(0, 2)
              if (LLevel.match('[L][0-5]')) {
                FixWorkerUTMNames(null, RouteTable, QueenInstance, Workers, EnvironmentLevel) // Next Function.
              } else {
                EmailBody += 'Queen Name Tag updated: ' + EnvironmentLevel + ' Queen UTM' + '\r\n'
                console.log('Queen Name Tag updated: ' + EnvironmentLevel + ' Queen UTM')
                var params = {Resources: [QueenInstance.InstanceId], Tags: [{Key: 'Name', Value: EnvironmentLevel + ' Queen UTM'}]}
                ec2.createTags(params, function (err) {
                  if (err) {
                    console.log(err) // Display error, no callback, waterfall over.
                  } else {
                    FixWorkerUTMNames(null, RouteTable, QueenInstance, Workers, EnvironmentLevel) // Next Function.
                  }
                })
              }
            }
          })
        },

  // --- Change the Workers Name Tag.  'Worker UTM' becomes 'L0 Worker UTM' for example.
        function FixWorkerUTMNames (RouteTable, QueenInstance, Workers, EnvironmentLevel, SetQueenVolumeNameTag) {
          var index = 0
          async.each(Workers, function (Worker) {
            index++
            async.each(Worker.Instances[0].Tags, function (Tag) {
              if (Tag.Key === 'Name') {
                var LLevel = Tag.Value.substring(0, 2)
                if (!LLevel.match('[L][0-5]')) {
                  EmailBody += 'Worker Name Tag updated: ' + EnvironmentLevel + ' Worker UTM' + '\r\n'
                  console.log('Worker Name Tag updated: ' + EnvironmentLevel + ' Worker UTM')
                  var params = {Resources: [Worker.Instances[0].InstanceId], Tags: [{Key: 'Name', Value: EnvironmentLevel + ' Worker UTM'}]}
                  ec2.createTags(params, function (err) {
                    if (err) { console.log(err) }
                  })
                }
              }
            })
            if (index === Workers.length) {
              SetQueenVolumeNameTag(null, RouteTable, QueenInstance, Workers, EnvironmentLevel) // Next Function.
            }
          })
        },

   // --- Set the Volume Name Tag for the Queen if it is not set correctly.
        function SetQueenVolumeNameTag (RouteTable, QueenInstance, Workers, EnvironmentLevel, SetWorkersVolumeNameTag) {
          var VolumeId = QueenInstance.BlockDeviceMappings[0].Ebs.VolumeId
          var params = {
            Filters: [
              { Name: 'resource-type', Values: ['volume'] },
              { Name: 'resource-id', Values: [VolumeId] },
              { Name: 'key', Values: ['Name'] },
              { Name: 'value', Values: [EnvironmentLevel + ' Queen UTM_ROOT'] }
            ]
          }
          ec2.describeTags(params, function (err, data) {
            if (err) {
              console.log(err)
            } else {
              if (data.Tags.length === 0) { // 0 = No Tag Found.
                EmailBody += 'Queen volume Tag updated: ' + EnvironmentLevel + ' Queen UTM_ROOT \r\n'
                console.log('Queen volume Tag updated: ' + EnvironmentLevel + ' Queen UTM_ROOT')
                var params = {Resources: [VolumeId], Tags: [{Key: 'Name', Value: EnvironmentLevel + ' Queen UTM_ROOT'}]}
                ec2.createTags(params, function (err) {
                  if (err) {
                    console.log(err)
                  } else {
                    SetWorkersVolumeNameTag(null, RouteTable, QueenInstance, Workers, EnvironmentLevel) // Next Function.
                  }
                })
              } else { // Tag was found.
                SetWorkersVolumeNameTag(null, RouteTable, QueenInstance, Workers, EnvironmentLevel) // Next Function.
              }
            }
          })
        },

   // --- Set the Volume Name Tag for the Workers if it is not set correctly.
        function SetWorkersVolumeNameTag (RouteTable, QueenInstance, Workers, EnvironmentLevel, SetQueenCPMBackupTag) {
          var index = 0
          async.eachSeries(Workers, function (Worker, next) {
            index++
            var VolumeId = Worker.Instances[0].BlockDeviceMappings[0].Ebs.VolumeId
            var params = {
              Filters: [
                { Name: 'resource-type', Values: ['volume'] },
                { Name: 'resource-id', Values: [VolumeId] },
                { Name: 'key', Values: ['Name'] },
                { Name: 'value', Values: [EnvironmentLevel + ' Worker UTM_ROOT'] }
              ]
            }
            ec2.describeTags(params, function (err, data) {
              if (err) {
                console.log(err) // Display error, no callback, waterfall over.
              } else {
                if (data.Tags.length === 0) { // 0 = No Tag Found.
                  EmailBody += 'Worker volume Tag updated: ' + EnvironmentLevel + ' Worker UTM_ROOT \r\n'
                  console.log('Worker volume Tag updated: ' + EnvironmentLevel + ' Worker UTM_ROOT')
                  var params = {Resources: [VolumeId], Tags: [{Key: 'Name', Value: EnvironmentLevel + ' Worker UTM_ROOT'}]}
                  ec2.createTags(params, function (err) {
                    if (err) {
                      console.log(err) // Display error, no callback, waterfall over.
                    } else {
                      if (index === Workers.length) {
                        SetQueenCPMBackupTag(null, RouteTable, QueenInstance, Workers) // Next Function.
                      } else {
                        next(null) // Next Worker.
                      }
                    }
                  })
                } else { // 1 = Correct Tag Found, Next Worker.
                  if (index === Workers.length) {
                    SetQueenCPMBackupTag(null, RouteTable, QueenInstance, Workers) // Next Function.
                  } else {
                    next(null) // Next Worker.
                  }
                }
              }
            })
          })
        },

   // --- Set the Queen 'cpm backup' Tag.
        function SetQueenCPMBackupTag (RouteTable, QueenInstance, Workers, FinalFunction) {
          var CPMBackupTag = 'no good'
          async.each(QueenInstance.Tags, function (Tag) { if (Tag.Key === 'cpm backup' && Tag.Value === 'sophos_backups') { CPMBackupTag = 'good' }; })
          if (CPMBackupTag === 'no good') {
            EmailBody += 'Queen cpm backup Tag updated: sophos_backups \r\n'
            console.log('Queen cpm backup Tag updated: sophos_backups')
            var params = {Resources: [QueenInstance.InstanceId], Tags: [{Key: 'cpm backup', Value: 'sophos_backups'}]}
            ec2.createTags(params, function (err) {
              if (err) {
                console.log(err)
              } else {
                FinalFunction(null, RouteTable, QueenInstance, Workers) // Next Function.
              }
            })
          } else {
            FinalFunction(null, RouteTable, QueenInstance, Workers) // Next Function.
          }
        },

   // --- End function as a place holder for the next thing this script may need to do.
        function FinalFunction (RouteTable, QueenInstance, Workers, EndWaterfall) {
          EmailBody += '--------------------------------------------------- \r\n'
          console.log('---------------------------------------------------')
          EndWaterfall(null) // Required to iterate the WaterFall loop.
        }

      ], function EndWaterfall (Result) { nextWaterfall(null) }) // End async.waterfall and next for eachSeries loop.
  }, function () {
    EmailBody += '-----------------------End------------------------- \r\n'
    console.log('-----------------------End-------------------------')
    EmailBody += 'async.eachSeries loop end. \r\n'
    console.log('async.eachSeries loop end.')
    var ses = new AWS.SES({apiVersion: '2010-12-01'})
    var to = ['greg.wright@test.com']
    var from = 'greg.wright@test.com'
    ses.sendEmail({
      Source: from,
      Destination: { ToAddresses: to },
      Message: {
        Subject: { Data: 'Sophos Lambda Script Completed.' },
        Body: {
          Text: {
            Data: EmailBody
          }
        }
      }
    }, function (err, data) {
      if (err) throw err
      console.log('Email sent:')
      context.done() // **** COMMENT OUT FOR TESTING ****
    })
  }) // End async.eachSeries.
} // **** COMMENT OUT FOR TESTING ****

