FROM node:14-alpine
WORKDIR /app
ADD . .
RUN yarn install --network-timeout 1000000
RUN yarn build
EXPOSE 8080
WORKDIR /app/build
CMD ["node", "--unhandled-rejections=strict", "app.js"]