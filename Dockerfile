FROM node:14-alpine as builder
WORKDIR /app
ADD . .
RUN yarn install --network-timeout 1000000
RUN yarn build

FROM node:14-alpine
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/build/ ./dist
EXPOSE 8080
ENV NODE_ENV = 'production'
USER node
CMD ["node", "--unhandled-rejections=strict", "./dist/app.js"]