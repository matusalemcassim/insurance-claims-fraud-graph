LOAD CSV WITH HEADERS FROM 'file:///addresses.csv' AS row
MERGE (a:Address {address_id: row.address_id})
SET a.street = row.street,
    a.city = row.city,
    a.state = row.state,
    a.zip = row.zip,
    a.latitude = toFloat(row.latitude),
    a.longitude = toFloat(row.longitude);
