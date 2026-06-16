# Errors

When using HTTP Proxy, errors are shown in the response of the proxy server after using the service. When using SOCKS5, errors are shown by status codes when creating a connection and authenticating. All the errors can be checked on the account dashboard.

**The list of HTTP errors:**

`400 Bad Request` - CONNECT request to the proxy server was created incorrectly.\
`403 PORT_BLOCKED` - The connection attempt is made to the blocked ports.\
`403 SITE_PERMANENTLY_BLOCKED` - The access to the specified site has been permanently blocked.\
`403 HOST_BLOCKED` - The access to the specified site has been blocked by user in the current plan settings.\
`407 NO_USER` - The user’s plan doesn’t exist.\
`407 TRAFFIC_EXHAUSTED` - The traffic limit of the plan is exceeded.\
`407 THREADS_EXHAUSTED` - The threads limit of the plan is exceeded.\
`407 PORT_NOT_ALLOWED` - Used sticky sessions port is not allowed by current plan settings.\
`407 USER_BLOCKED` - The user’s current plan has been blocked.\
`500 INTERNAL_SERVER_ERROR` - The server encountered an unexpected condition that prevented it from fulfilling the request.\
`502 NO_HOST_CONNECTION` - There is no connection to the host specified in the CONNECT request.\
`503 NO_RAY` - There are no proxies available based on the targeting parameters specified in the request.\ <br>

**The list of SOCKS5 errors:**

For such errors as `NO_USER`, `REQUESTS_EXHAUSTED`, `TRAFFIC_EXHAUSTED`, `THREADS_EXHAUSTED` an unsuccessful authentication response will be returned with the Denied status when there was an attempt to connect to a proxy server\
\
For such errors as `PORT_BLOCKED`, `NO_RAY`, `NO_HOST_CONNECTION` authentication will be passed, after which, the proxy connection will be reset I there is an attempt of the UDP connection, the connection will be dropped.&#x20;

`UDP_BIND_FAILED` – Failed to bind a local UDP port, preventing the UDP connection from being established. This error is similar to `502 NO_HOST_CONNECTION`, but occurs when using the UDP protocol.

More details relevant to the errors can be found on our blog: [Proxy Errors: Types, Causes, and Solutions](https://dataimpulse.com/blog/proxy-errors-types-causes-and-solutions/)
