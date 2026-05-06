#!/bin/bash
echo "begin;"
sqlite3 db "select name from sqlite_schema where type='trigger';" | sed 's/.*/drop trigger &;/'
sqlite3 db "select name from sqlite_schema where type='view';" | sed 's/.*/drop view &;/'
echo ".read schema.sql"
echo "commit;"
