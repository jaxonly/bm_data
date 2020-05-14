// 初始化 redis
const Redis = require('ioredis');
const redis = new Redis({
    port: 6379, // Redis port
    host: "r-bp14pz4hoqv1zweufhpd.redis.rds.aliyuncs.com", // Redis host
    password: "wQAQ9Ry2qkr8twM",
    db: 10,
});

// 初始化 headless 浏览器
const PCR = require("puppeteer-chromium-resolver");
let pcr;
let browser;
(async () => {
    pcr = await PCR();
    browser = await pcr.puppeteer.launch({
        defaultViewport: {
            width: 100,
            height: 100,
        },
        headless: true,
        args: ['--no-sandbox'],
        executablePath: pcr.executablePath
    }).catch(function (error) {
        console.log(error);
    });
    onReady()
})();

// 资源释放
process.on('exit', async function () {
    await browser.close()
});

async function getAllCategoryUrls() {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)'),
        await page.goto('https://www.brandymelvilleonline.com.cn/');
    let categorys = await page.evaluate('[...document.querySelectorAll(\'.sticky-menu a\')].map(a => { return { href: a.href, name: a.innerText }}).filter(h => h.href.startsWith(\'https://www.brandymelvilleonline.com.cn/\'))');

    // 移除父节点
    const hrefList = categorys.map(c => c.href);
    categorys = categorys.filter(c => {

        let number = hrefList.find(h => h.includes(c.href + '/'));
        if(number) {
            return false;
        }
        // 去除上新和基础款重复
        const exclude = [
            'https://www.brandymelvilleonline.com.cn/basics',
            'https://www.brandymelvilleonline.com.cn/just-in',
        ];
        if(exclude.includes(c.href)) {
            return false
        }
        return true;
    });
    await page.close();
    return categorys;
}

async function getDetailUrl(url) {
    const page = await browser.newPage();
    await page.goto(url);

    const realUrl = await page.evaluate('document.querySelector(\'.quick_view_link_container a\')?.href');

    console.log(`getDetailUrl: ${url} => ${realUrl}`);

    await page.close();
    return realUrl;
}

async function fetchByUrls(urls) {
    console.log(`=======fetchByUrls start.=======`);
    console.time('fetchByUrls');

    const page = await browser.newPage();
    const items = [];

    for(const url of urls) {
        console.log(`=======开始获取 【 ${url.name} 】 列表=======`);
        console.time(`=======开始获取 【 ${url.name} 】 列表=======`);
        let nextHref = url.href;
        while(nextHref) {

            console.time(`fetch ${nextHref}`);
            await page.goto(nextHref);
            let map = (await page.evaluate('' +
                '[...document.querySelectorAll(\'.products-grid .wrapper-items .product-item\')].map(a => {\n' +
                '    return {\n' +
                '        href: a.querySelector(\'.swiper-container .quickViewContainer\').href,\n' +
                '        cover: [...a.querySelectorAll(\'.swiper-container .swiper-wrapper .product-item-image a img\')].map(a => a.src),\n' +
                '        name: a.querySelector(\'.product-item-info .product-item-name a\').innerText,\n' +
                '        price: a.querySelector(\'.price-box .price\').innerText\n' +
                '    }\n' +
                '})' +
                ''))
                .map((a) => {
                    return Object.assign(a, {
                        category: url.name,
                    })
                });
            console.timeEnd(`fetch ${nextHref}`);
            items.push(
                ...map
            );
            // 下一页连接
            nextHref = await page.evaluate('document.querySelector(\'a.next\')?.href');
        }
        console.timeEnd(`=======开始获取 【 ${url.name} 】 列表=======`);
    }

    //  {
    //     href: 'https://www.brandymelvilleonline.com.cn/catalog/ajax_product/view/id/10399',
    //     cover: [
    //       'https://alicdn.brandymelvilleonline.com.cn/media/catalog/product/cache/3/image/414x621/9df78eab33525d08d6e5fb8d27136e95/m/h/mh369-z320s0020000_2.jpg',
    //       'https://alicdn.brandymelvilleonline.com.cn/media/catalog/product/cache/3/image/414x621/9df78eab33525d08d6e5fb8d27136e95/m/h/mh369-z320s0020000_1x.jpg',
    //       'https://alicdn.brandymelvilleonline.com.cn/media/catalog/product/cache/3/image/414x621/9df78eab33525d08d6e5fb8d27136e95/m/h/mh369-z320s0020000_1.jpg',
    //       'https://alicdn.brandymelvilleonline.com.cn/media/catalog/product/cache/3/image/414x621/9df78eab33525d08d6e5fb8d27136e95/m/h/mh369-z320s0020000_2.jpg',
    //       'https://alicdn.brandymelvilleonline.com.cn/media/catalog/product/cache/3/image/414x621/9df78eab33525d08d6e5fb8d27136e95/m/h/mh369-z320s0020000_1x.jpg'
    //     ],
    //     name: 'Helena Top',
    //     price: '￥ 160',
    //     category: '新款上市'
    //   }

    const obj = {};

    // 处理类型合并及ID提取
    items.map(item => {
        const splits = item.href.split('/');
        const id = splits[splits.length - 1];

        let objElement = obj[id];
        if(!objElement) {
            obj[id] = {
                ...item,
                category: [item.category],
                id
            };
        } else {
            // 合并类型
            objElement.category.push(item.category)
        }
    });

    for(let objKey in obj) {
        const good = obj[objKey];
        const hset = await redis.hset('goods', good.id, JSON.stringify(good));
        if(hset === 1) {
            await page.goto(`https://tgbot.lbyczf.com/sendMessage/9qvms1saka190aje?text=${encodeURIComponent(
`
BrandyMelville 上新啦!
【 ${good.category} 】
【 ${good.name} 】
💰 【 ${good.price} 】
🔗 【 ${await getDetailUrl(good.href)} 】
`)}&photo=${good.cover[0]}`)
        }
    }

    console.timeEnd('fetchByUrls');
    console.log(`=======fetchByUrls end.=======`);
    await page.close();
    return 0;
}

async function onReady() {
    async function mointGood() {
        // 监控所有
        // await fetchByUrls(await getAllCategoryUrls());
        // // 监控包包
        try {
            await fetchByUrls([
                {
                    name: '手提包&双肩包',
                    href: 'https://www.brandymelvilleonline.com.cn/accessories/bags-backpacks',
                }
            ]);
        } catch (e) {
            console.error(e)
        }
        let s = Math.random() * 30;
        let timeout = Math.ceil(s * 1000);
        console.log(`${timeout}ms后再次刷新...`);
        setTimeout(() => {
            mointGood();
        }, timeout);
    }

    mointGood();
}
