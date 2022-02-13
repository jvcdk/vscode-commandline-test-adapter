#!/usr/bin/env bash

set -eu

die() {
    echo "$@" >&2
    exit 1
}

[[ $# -ge 1 ]] || die "Missing arg testname."

case "$1" in
    genRandom)
        mkdir -p tmp
        echo $(($RANDOM % 10)) > tmp/limit
        ;;
    
    compare)
        [[ $# -ge 2 ]] || die "Missing value argument for compare."
        [[ -f tmp/limit ]] || die "Please run parent test first."
        num=$(cat tmp/limit)
        echo "Limit is $num."
        [[ $num -ge $2 ]]
        ;;

    random)
        [[ $# -ge 2 ]] || die "Missing value argument for random."
        num=$(($RANDOM % 10))
        echo "Limit is $num."
        [[ $num -ge $2 ]]
        ;;

    *)
        die "Unknown command / test."
        ;;
esac
