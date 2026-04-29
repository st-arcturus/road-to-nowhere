#!/bin/bash

cat <<EOF
insert or ignore into blacklist_mail values

-- common mis-spellings
 ('%.con')
,('%@gmail')
,('%@example.com')

-- won't lift blacklist
,('%@t-online.de')

EOF

curl -s https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/refs/heads/main/disposable_email_blocklist.conf | \
	sed "s/.*/,('%@&')/"
echo ";"

