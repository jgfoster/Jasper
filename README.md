# Jasper

> A web-based tool for GemStone/S 64 Bit

## Build Setup

``` bash
# install dependencies
npm install

# serve with hot reload at localhost:8080
npm run dev

# build for production with minification
npm run build

# build for production and view the bundle analyzer report
npm run build --report
```

Note that node_modules is *no longer* included in the Git checkout. This added about 200 MB to the checkout, and it is needed. An [argument](https://web.archive.org/posts/nodemodules-in-git.html) for inclusion is that a required package might [disappear](https://eslint.org/blog/2018/07/postmortem-for-malicious-package-publishes).
