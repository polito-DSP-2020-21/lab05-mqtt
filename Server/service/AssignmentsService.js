'use strict';

const Task = require('../components/task');
const User = require('../components/user');
const db = require('../components/db');
const moment = require('moment');
var WSMessage = require('../components/ws_message.js');
var WebSocket = require('../components/websocket');
const mqtt = require('../components/mqtt');
const MQTTTaskMessage = require('../components/mqtt_task_message.js');

/**
 * Reassign tasks in a balanced manner
 *
 * returns inline_response_201
 **/
exports.assignBalanced = function() {
  return new Promise((resolve, reject) => {
    const sql = "SELECT t1.id FROM tasks t1 LEFT JOIN assignments t2 ON t2.task = t1.id WHERE t2.task IS NULL";
    db.each(sql, (err, tasks) => {
        if (err) {
            reject(err);
        } else {
            exports.assignEach(tasks.id).then(function(userid) {
                resolve(userid);
            });
        }
    });
    resolve();
  });
}


/**
 * Assign a user to the task
 *
 * body Body_1 ID of the user to assign to the task
 * taskId Long ID of the task
 * returns body_1
 **/
exports.assignTaskToUser = function(userId,taskId) {
  return new Promise((resolve, reject) => {
    const sql = 'INSERT INTO assignments(task, user) VALUES(?,?)';
    db.run(sql, [taskId, userId], function(err) {
        if (err) {
            reject(err);
        } else {
            resolve();
        }
    });
});
}


/**
 * Retreve the users assignted to the task
 * The users that are retrieved are the users that are assigned to the task characterized by the specified ID
 *
 * taskId Long ID of the task to retrieve
 * returns List
 **/
exports.getUsersAssigned = function(taskId) {
  return new Promise((resolve, reject) => {
    const sql = "SELECT u.id as uid, u.name, u.email FROM assignments as a, users as u WHERE  a.task = ? AND a.user = u.id";
    db.all(sql, [taskId], (err, rows) => {
        if (err) {
            reject(err);
        } else {
            let users = rows.map((row) => new User(row.uid, row.name, row.email, null));
            resolve(users);
        }
    });
  });
}


/**
 * Remove a user from the assigned task
 * The user that is remove is the user, identified by userId, that was assigned to the task identified by taskId
 *
 * taskId Long ID of the assigned task
 * userId Long ID of the user to remove
 * no response value expected for this operation
 **/
exports.removeUser = function(taskId,userId) {
  return new Promise((resolve, reject) => {
    const sql = 'DELETE FROM assignments WHERE task = ? AND user = ?';
    db.run(sql, [taskId, userId], (err) => {
        if (err)
            reject(err);
        else
            resolve(null);
    })
  });
}



exports.selectTask = function selectTask(userId, taskId) {
    return new Promise((resolve, reject) => {

        db.serialize(function() {  

            db.run('BEGIN TRANSACTION;');
            
            const sql1 = 'SELECT t.id FROM assignments as a, tasks as t WHERE a.user = ? AND a.task = t.id AND a.active = 1';
            db.all(sql1, [userId], function(err, rows1) {
                if (err) {
                    db.run('ROLLBACK;')
                    reject(err);
                } else {
                    var deselected = null;
                    if(rows1.length !== 0) deselected = rows1[0].id;
                    const sql2 = 'SELECT u.name, t.description FROM assignments as a, users as u, tasks as t WHERE a.user = ? AND a.task = ? AND a.user = u.id AND a.task = t.id';
                    db.all(sql2, [userId, taskId], function(err, rows2) {
                        if (err) {
                            db.run('ROLLBACK;')
                            reject(err);
                        } else if(rows2.length === 0) {
                            reject("Not_Found");
                        } else {
                            const sql3 = 'UPDATE assignments SET active = 0 WHERE user = ?';
                            db.run(sql3, [userId], function(err) {
                                if (err) {
                                    db.run('ROLLBACK;')
                                    reject(err);
                                } else {
                                    const sql4 = 'UPDATE assignments SET active = 1 WHERE user = ? AND task = ? AND NOT EXISTS (SELECT * FROM assignments WHERE user <> ? AND task = ? AND active = 1)';
                                    db.run(sql4, [userId, taskId, userId, taskId], function(err) {
                                        if (err) {
                                            db.run('ROLLBACK;')
                                            reject(err);
                                        } else if (this.changes == 0) {
                                            db.run('ROLLBACK;')
                                            reject("Task already assigned to another user");
                                        } else {
                                                    db.run('COMMIT TRANSACTION;');

                                                    console.log(deselected);

                                                    //publish the MQTT message for the selected task
                                                    var message = new MQTTTaskMessage("active", parseInt(userId), rows2[0].name);
                                                    mqtt.saveMessage(taskId, message);
                                                    mqtt.publishTaskMessage(taskId, message);

                                                    //publish the MQTT message for the selected task
                                                    if(deselected){
                                                        var message = new MQTTTaskMessage("inactive", null, null);
                                                        mqtt.saveMessage(deselected, message);
                                                        mqtt.publishTaskMessage(deselected, message);
                                                    }
                                                    

                                                    //inform the clients that the user selected a different task where they are working on
                                                    var updateMessage = new WSMessage('update', parseInt(userId), rows2[0].name, parseInt(taskId), rows2[0].description);
                                                    WebSocket.sendAllClients(updateMessage);
                                                    WebSocket.saveMessage(userId, new WSMessage('login', parseInt(userId), rows2[0].name, parseInt(taskId), rows2[0].description));
                                        
                                                    resolve();
                                                
                                            }
                                        })
                                    }
                                })


                        }

                    });
                }


            });


            

        
    });
  });
}

exports.getTaskSelections = function getTaskSelections() {
    return new Promise((resolve, reject) => {
        const sql = "SELECT t.id as taskId, u.id as userId, u.name as userName FROM tasks as t LEFT JOIN assignments as a ON t.id = a.task AND active = 1 LEFT JOIN users u ON u.id = a.user";
        db.all(sql, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
      });
}


/**
 * Utility functions
 */

exports.assignEach = function(id) {
  return new Promise((resolve, reject) => {
      const sql = "SELECT user, MIN(Count) as MinVal     FROM     (SELECT user,COUNT(user) as Count     FROM assignments    GROUP BY user) T";
      var user = null;
      db.get(sql, (err, user) => {
          if (err) {
              reject(err);
          } else {
              exports.assignTaskToUser(user.user, id).then(resolve(user.user));
          }
      });
  });
}