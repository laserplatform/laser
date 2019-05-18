#!/bin/bash
for (( i=0; i<100; ++i)); do
    find $1 > /dev/null
done
