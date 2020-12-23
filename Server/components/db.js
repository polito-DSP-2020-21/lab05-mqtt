'use strict';

const sqlite = require('sqlite3').verbose();
const path = require('path');

const DBSOURCE = path.join(__dirname, '../database/databaseV4.db');
console.log(DBSOURCE);

const db = new sqlite.Database(DBSOURCE, (err) => {
    if (err) {
        // Cannot open database
        console.error(err.message);
        throw err;
    }

    db.exec('PRAGMA foreign_keys = ON;', function(error)  {
        if (error){
            console.error("Pragma statement for foreign keys didn't work.")
        }
    });
    db.exec('PRAGMA journal_mode = WAL;', function(error)  {
        if (error){
            console.error("Pragma statement for journal mode didn't work.")
        }
    });
});

module.exports = db;
