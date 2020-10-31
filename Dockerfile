FROM node:14-alpine as builder
WORKDIR /express/app
ADD . .
RUN yarn install --network-timeout 1000000
RUN yarn build

FROM node:14-alpine
COPY --from=builder /express/app/build/ /express/app/build
EXPOSE 8080
WORKDIR /express/app/build
CMD ["node", "--unhandled-rejections=strict", "app.js"]