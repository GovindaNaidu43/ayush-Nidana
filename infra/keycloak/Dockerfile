FROM quay.io/keycloak/keycloak:26.0

COPY medikiosk-realm.json /opt/keycloak/data/import/medikiosk-realm.json

ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--http-enabled=true", "--proxy-headers=xforwarded", "--import-realm"]