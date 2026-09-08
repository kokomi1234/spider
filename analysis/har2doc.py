#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
har2doc —— 从 HAR 抓包文件生成接口文档

做了 spider.py 没做的几件事：
  1. URL 归一化 + 去重      : 剔除 ?n=0.12345 这类防缓存随机数，同一接口多次调用合并为一条
  2. JSON Schema 推断       : 递归推导请求/响应的字段结构，输出字段表格而不是裸 JSON
  3. 多样本合并             : 同一接口的多次调用，请求参数取并集、响应结构取并集
  4. 敏感信息脱敏           : token / session / cookie 等自动打码
  5. 字段中文注释           : 驼峰拆分 + 内置词典，自动给出可读的字段名说明
  6. 双输出                 : Markdown（人读）+ OpenAPI 3.0（导入 Apifox / Postman）

用法：
    python3 har2doc.py trace.har
    python3 har2doc.py trace.har -o output/ --format both
    python3 har2doc.py trace.har --host itamp.bocsys.cn --no-mask

纯标准库，无需 pip install。
"""

import argparse
import json
import os
import re
import sys
from collections import OrderedDict, defaultdict
from urllib.parse import urlsplit, parse_qsl, unquote

# ---------------------------------------------------------------- 配置区

# 静态资源后缀，直接丢弃
STATIC_SUFFIX = (
    ".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico",
    ".woff", ".woff2", ".ttf", ".eot", ".map", ".mp4", ".mp3", ".wav",
)

# 需要脱敏的头部 / 字段（小写匹配）
SENSITIVE_KEYS = (
    "token", "ssopsessionid", "authorization", "cookie", "set-cookie",
    "session", "sessionid", "password", "passwd", "secret", "accesskey",
    "secretkey", "signature", "sign", "udptoken", "jwt", "apikey", "api-key",
)
MASK_VALUE = "***（已脱敏）***"

# 疑似防缓存随机数参数名
NOISE_PARAM_NAMES = {"n", "_", "t", "ts", "timestamp", "_t", "rnd", "random", "v", "cb"}

# RESTful 路径参数：纯数字、UUID、长十六进制段
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
HEX_RE = re.compile(r"^[0-9a-f]{16,}$", re.I)
INT_RE = re.compile(r"^\d+$")

# ---------------------------------------------------------------- 接口描述配置
# 格式：(method, path_segment_or_regex) -> 中文描述
# 支持精确匹配和正则匹配（以 ^ 开头）
ENDPOINT_DESCRIPTIONS = [
    # 产品批次列表查询
    ("POST", "/itamp-tool/publish/getInformationProdBatch",
     "根据组件编号查询该组件下所有产品批次的系统服务号列表，用于下拉选择等场景。"
     "返回的 sysServeNoList 包含 label（展示名）、value（实际值）、shortEn（英文简称）。"),
    # 服务编码列表查询
    ("POST", "/itamp-tool/publish/getInformationServerCoding",
     "根据组件编号查询该组件下所有服务的编码列表，用于前端下拉框/搜索框的数据源。"),
    # 发布数据分页列表
    ("POST", "/itamp-tool/publish/getPublishDataList",
     "分页查询服务发布数据列表，支持按批次、服务名称、服务状态等多维度筛选。"),
    # 文本数据 / 附件查询
    ("POST", "/itamp-tool/publish/getTextData",
     "根据组件编号查询关联的文档/附件信息（如接口文档文件），以及对应的文本数据内容。"),
]

# 也可用正则匹配更通用的模式
import re as _re
ENDPOINT_DESCRIPTIONS.extend([
    ("POST", _re.compile(r"/itamp-tool/publish/.*"),
     "ITAMP 平台发布管理相关接口，具体功能见下方详细说明。"),
])

# 字符串格式识别
DATETIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
URI_RE = re.compile(r"^https?://")

# 字段名 -> 中文注释词典（命中不了就留空，不瞎编）
FIELD_DICT = {
    "code": "业务状态码", "msg": "提示信息", "message": "提示信息", "data": "业务数据",
    "total": "总记录数", "rows": "数据列表", "list": "数据列表", "records": "数据列表",
    "result": "返回结果", "success": "是否成功", "error": "错误信息",
    "pageNum": "页码", "pageSize": "每页条数", "page": "页码", "size": "每页条数",
    "id": "主键ID", "name": "名称", "title": "标题", "type": "类型", "status": "状态",
    "remark": "备注", "context": "正文内容", "content": "内容", "version": "版本",
    "createTime": "创建时间", "updateTime": "更新时间", "createBy": "创建人", "updateBy": "更新人",
    "creater": "创建人", "updater": "更新人", "startTime": "开始时间", "endTime": "结束时间",
    "effectiveTime": "生效时间", "offlineTime": "失效时间", "time": "时间",
    "userId": "用户ID", "userName": "用户名", "deptId": "部门ID", "deptName": "部门名称",
    "url": "地址", "path": "路径", "method": "请求方法", "key": "键", "value": "值",
    "label": "展示名称", "shortEn": "英文简称", "index": "序号", "order": "排序",
    "serviceName": "服务名称", "serviceId": "服务ID", "serviceType": "服务类型",
    "serviceNumber": "服务编号", "serviceVersion": "服务版本", "interfaceCode": "接口编码",
    "serverCoding": "服务编码", "serverVsn": "服务版本", "sysServeNo": "系统服务号",
    "compNum": "组件编号", "assemblyNo": "组件编号", "batch": "批次",
    "sheetProductBatch": "产品批次", "productBatch": "产品批次", "prodBatch": "产品批次",
    "provideComponentName": "提供方组件名称", "provideSystemNumber": "提供方系统编号",
    "serviceFunctionDescription": "服务功能描述", "gatewayCode": "网关编码",
    "subscriberStatus": "订阅状态", "serviceStatus": "服务状态", "principal": "负责人",
    "principalName": "负责人姓名", "implementationUnit": "实施单位",
    "callerComponent": "调用方组件", "isSendOutsideSystem": "是否对外系统发送",
    "isChecked": "是否已核对", "chapterId": "章节ID", "fileInfo": "文件信息",
    "textDataList": "文本数据列表", "sysEnName": "系统英文名称", "sysType": "系统类型",
    "sysServeEnName": "系统服务英文名", "serveTyep": "服务性质", "targetServeNo": "目标服务号",
    "serverNo": "服务编号", "serverMode": "服务模式", "isSend": "是否已发送",
    "tag": "标签", "productNo": "产品编号", "productName": "产品名称", "isMember": "是否成员",
    "pubVersion": "发布版本", "subscriberTechNum": "订阅方技术编号",
    "publishSubcriptionId": "发布订阅ID", "offerServerState": "提供服务状态",
    "versionBatch": "版本批次", "versionServerNo": "版本服务号",
    "offerVersionBatch": "提供版本批次", "offerVersionServerNo": "提供版本服务号",
    "offerEffectiveTime": "提供生效时间", "offerOfflineTime": "提供失效时间",
    "isOperation": "是否运营", "publishId": "发布ID", "serverCodingList": "服务编码列表",
    "sysServeNoList": "系统服务号列表", "serviceVersionList": "服务版本列表",
    "operationRecord": "操作记录", "historyId": "历史ID", "detail": "详情",
    "judgeInfo": "判定信息", "operationType": "操作类型", "operator": "操作人",
    "operationTime": "操作时间", "before": "变更前", "after": "变更后",
}

# 单词级补充词典（驼峰拆分后逐词翻译时用）
WORD_DICT = {
    "get": "获取", "query": "查询", "search": "搜索", "list": "列表", "page": "分页",
    "save": "保存", "add": "新增", "create": "创建", "update": "更新", "edit": "编辑",
    "delete": "删除", "remove": "删除", "del": "删除", "export": "导出", "import": "导入",
    "upload": "上传", "download": "下载", "submit": "提交", "confirm": "确认",
    "check": "校验", "verify": "验证", "approve": "审批", "audit": "审核",
    "publish": "发布", "info": "信息", "information": "信息", "detail": "详情",
    "history": "历史", "record": "记录", "operation": "操作", "user": "用户",
    "service": "服务", "data": "数据", "batch": "批次", "version": "版本",
    "coding": "编码", "server": "服务", "system": "系统", "product": "产品",
    "prod": "产品", "component": "组件", "judge": "判定", "base": "基础",
    "capacity": "容量", "performance": "性能", "sub": "子", "text": "文本",
    "file": "文件", "approval": "审批", "common": "公共", "count": "数量",
    # 常见 HTTP 头（按小写匹配）
    "accept": "客户端可接受的响应格式", "accept-language": "语言偏好",
    "origin": "请求来源域", "referer": "来源页面", "user-agent": "客户端标识",
    "content-type": "请求体格式", "authmethods": "认证方式",
    "systemid": "系统标识", "sessionid": "会话ID",
    "ssopstatuscode": "单点登录状态码", "cookie": "会话凭证",
}


# ---------------------------------------------------------------- 工具函数

def camel_split(name):
    """serviceFunctionDescription -> [service, function, description]"""
    # 先按下划线/连字符切，再按驼峰切
    parts = []
    for seg in re.split(r"[_\-\s]+", name):
        seg = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", seg)
        seg = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", " ", seg)
        parts.extend(p for p in seg.split() if p)
    return parts


def describe_field(name):
    """字段中文注释：整名命中 -> 单词拼接 -> 空"""
    if not name:
        return ""
    if name in FIELD_DICT:
        return FIELD_DICT[name]
    low = name.lower()
    if low in FIELD_DICT:
        return FIELD_DICT[low]
    words = camel_split(name)
    if not words:
        return ""
    trans = [WORD_DICT.get(w.lower(), "") for w in words]
    if all(t for t in trans):
        return "".join(trans)
    return ""


def describe_endpoint(path):
    """从路径末段推断接口用途"""
    seg = [s for s in path.split("/") if s and not s.startswith("{")]
    if not seg:
        return ""
    last = seg[-1]
    words = camel_split(last)
    trans = [WORD_DICT.get(w.lower(), w) for w in words]
    head = trans[0] if trans else ""
    return "".join(trans[:1]) + "".join(trans[1:]) if trans else last


def mask_sensitive(key, value):
    low = key.lower()
    for sk in SENSITIVE_KEYS:
        if sk in low:
            return MASK_VALUE
    return value


def is_sensitive(key):
    low = key.lower()
    return any(sk in low for sk in SENSITIVE_KEYS)


def trunc_str(s, limit=48):
    s = str(s)
    s = s.replace("\n", " ").replace("|", "\\|")
    return s if len(s) <= limit else s[:limit] + "…"


PCT_ENC_RE = re.compile(r"(?:%[0-9A-Fa-f]{2}){2,}")


def urldecode_rich(s):
    """把 %E9%83%91%E6%A2%93 这种编码的中文还原，便于阅读"""
    if not isinstance(s, str) or "%" not in s:
        return s
    def rep(m):
        try:
            d = unquote(m.group(0))
            # 只接受还原后是可读内容的（中文、常见符号），避免把签名串搞乱
            if any("\u4e00" <= c <= "\u9fff" or c in "@._- " for c in d):
                return d
        except Exception:
            pass
        return m.group(0)
    return PCT_ENC_RE.sub(rep, s)


# ---------------------------------------------------------------- Schema 推断

class Schema(object):
    """极简 JSON Schema 推断结果"""

    __slots__ = ("types", "format", "example", "required", "properties", "items", "n_samples")

    def __init__(self):
        self.types = set()          # {'string','integer',...}
        self.format = None          # date-time / email / uri
        self.example = None         # 示例值（原始）
        self.required = True        # 在所有样本中都出现 -> 必填
        self.properties = OrderedDict()   # object 子字段
        self.items = None           # array 元素 Schema
        self.n_samples = 0

    # -- 类型展示
    @property
    def type(self):
        if not self.types:
            return "any"
        order = ["object", "array", "string", "integer", "number", "boolean", "null"]
        for t in order:
            if t in self.types:
                return t
        return "/".join(sorted(self.types))

    def type_label(self):
        if self.types == {"null"}:
            return "null"
        ts = sorted(t for t in self.types if t != "null")
        if not ts:
            return "any"
        if len(ts) == 1:
            t = ts[0]
            if t == "array":
                sub = self.items.type_label() if self.items else "any"
                if sub in ("any", "null"):
                    return "array"          # 空数组，元素类型未知
                return "array[%s]" % sub
            return t
        return "|".join(ts)

    def to_json_schema(self):
        """转成 OpenAPI 能吃的 JSON Schema"""
        ts = sorted(t for t in self.types if t != "null")
        node = {}
        if not ts:
            node["nullable"] = True
            return node
        t = ts[0] if len(ts) == 1 else "string"
        node["type"] = t
        if len(ts) > 1:
            node["x-observed-types"] = ts
        if self.format:
            node["format"] = self.format
        if t == "object" and self.properties:
            props, req = {}, []
            for k, v in self.properties.items():
                props[k] = v.to_json_schema()
                if v.required:
                    req.append(k)
            node["properties"] = props
            if req:
                node["required"] = req
        if t == "array" and self.items:
            node["items"] = self.items.to_json_schema()
        ex = self.json_safe_example()
        if ex is not None:
            node["example"] = ex
        return node

    def json_safe_example(self):
        """示例值：长字符串截断、数组只留 2 项、敏感值打码"""
        if self.example is None:
            return None
        return _shrink(self.example)

    # -- 扁平化成表格行
    def flatten(self, prefix="", depth=0, out=None, seen=None):
        if out is None:
            out = []
        if seen is None:
            seen = set()
        t = self.type
        if t == "object" and self.properties:
            for k, v in self.properties.items():
                key = "%s.%s" % (prefix, k) if prefix else k
                out.append({
                    "depth": depth, "path": key, "type": v.type_label(),
                    "required": v.required, "desc": describe_field(k),
                    "example": _example_text(v),
                })
                if seen_guard(seen, key, v):
                    v.flatten(key, depth + 1, out, seen)
        elif t == "array" and self.items is not None:
            key = "%s[]" % prefix
            it = self.items
            if it.type == "object" and it.properties:
                for k, v in it.properties.items():
                    sub = "%s.%s" % (key, k)
                    out.append({
                        "depth": depth, "path": sub, "type": v.type_label(),
                        "required": v.required, "desc": describe_field(k),
                        "example": _example_text(v),
                    })
                    if seen_guard(seen, sub, v):
                        v.flatten(sub, depth + 1, out, seen)
            else:
                out.append({
                    "depth": depth + 1, "path": key, "type": it.type_label(),
                    "required": False, "desc": "", "example": _example_text(it),
                })
        return out


def seen_guard(seen, key, schema):
    """防止自引用/超深递归；返回是否继续下钻"""
    if key in seen:
        return False
    seen.add(key)
    return schema.type in ("object", "array")


def _shrink(v, depth=0, arr_keep=2):
    """把示例值压成适合放进文档的大小"""
    if isinstance(v, dict):
        return {k: _shrink(x, depth + 1, arr_keep) for k, x in list(v.items())[:40]}
    if isinstance(v, (list, tuple)):
        head = [_shrink(x, depth + 1, arr_keep) for x in v[:arr_keep]]
        if len(v) > arr_keep:
            head.append("…（共 %d 项）" % len(v))
        return head
    if isinstance(v, str):
        return v if len(v) <= 120 else v[:120] + "…"
    return v


def _example_text(schema):
    """表格里的示例列"""
    ex = schema.json_safe_example()
    if ex is None:
        return "-"
    if isinstance(ex, dict):
        return "{…}"
    if isinstance(ex, (list, tuple)):
        return "[…]"
    if isinstance(ex, bool):
        return "true" if ex else "false"
    if ex == "":
        return '""'
    return trunc_str(ex, 36)


def infer(value, mask_key=None):
    """从单个 Python 值推断 Schema"""
    s = Schema()
    s.n_samples = 1
    if value is None:
        s.types.add("null")
        s.example = None
        return s
    if isinstance(value, bool):
        s.types.add("boolean")
        s.example = value
    elif isinstance(value, int):
        s.types.add("integer")
        s.example = value
    elif isinstance(value, float):
        s.types.add("number")
        s.example = value
    elif isinstance(value, str):
        s.types.add("string")
        if DATETIME_RE.match(value):
            s.format = "date-time"
        elif DATE_RE.match(value):
            s.format = "date"
        elif EMAIL_RE.match(value):
            s.format = "email"
        elif URI_RE.match(value):
            s.format = "uri"
        s.example = value
    elif isinstance(value, (list, tuple)):
        s.types.add("array")
        s.example = list(value)
        merged = None
        for item in value[:200]:          # 大数组只采样前 200 个
            sub = infer(item)
            merged = sub if merged is None else merge(merged, sub)
        s.items = merged
    elif isinstance(value, dict):
        s.types.add("object")
        s.example = dict(value)
        for k, v in value.items():
            s.properties[k] = infer(v, mask_key=k)
    else:
        s.types.add("string")
        s.example = str(value)
    return s


def merge(a, b):
    """合并两个 Schema（同一接口多次调用/数组多个元素）"""
    if a is None:
        return b
    if b is None:
        return a
    out = Schema()
    out.n_samples = a.n_samples + b.n_samples
    out.types = a.types | b.types
    out.format = a.format or b.format
    out.example = a.example if a.example is not None else b.example
    out.required = a.required and b.required

    if "object" in out.types and (a.properties or b.properties):
        keys = list(a.properties.keys())
        for k in b.properties:
            if k not in keys:
                keys.append(k)
        props = OrderedDict()
        for k in keys:
            va, vb = a.properties.get(k), b.properties.get(k)
            if va is not None and vb is not None:
                m = merge(va, vb)
            else:
                m = va if va is not None else vb
                m = clone(m)
                if va is None:            # 只在部分样本出现 -> 非必填
                    m.required = False
                else:
                    m.required = False
            props[k] = m
        out.properties = props
    if "array" in out.types:
        if a.items is not None and b.items is not None:
            out.items = merge(a.items, b.items)
        else:
            out.items = clone(a.items if a.items is not None else b.items)
    return out


def clone(s):
    if s is None:
        return None
    c = Schema()
    c.types = set(s.types)
    c.format = s.format
    c.example = s.example
    c.required = s.required
    c.n_samples = s.n_samples
    c.properties = OrderedDict((k, clone(v)) for k, v in s.properties.items())
    c.items = clone(s.items)
    return c


# ---------------------------------------------------------------- URL 归一化

def split_url(url):
    u = urlsplit(url)
    path = u.path or "/"
    query = parse_qsl(u.query, keep_blank_values=True)
    return u.scheme, u.netloc, path, query


def normalize_path(path):
    """把路径中疑似 ID 的段替换成 {id}"""
    segs = []
    for seg in path.split("/"):
        if not seg:
            segs.append(seg)
            continue
        if UUID_RE.match(seg) or HEX_RE.match(seg):
            segs.append("{id}")
        elif INT_RE.match(seg) and len(seg) >= 4:
            segs.append("{id}")
        else:
            segs.append(seg)
    return "/".join(segs)


def is_noise_param(name, values):
    """防缓存随机数：参数名在黑名单里，或值全是长浮点/长数字且互不相同"""
    if name.lower() in NOISE_PARAM_NAMES:
        return True
    uniq = set(values)
    if len(uniq) < 2 or len(values) < 2:
        return False
    pat = re.compile(r"^0\.\d{6,}$")          # 0.24716408803949097
    if all(pat.match(v) for v in values):
        return True
    if all(v.isdigit() and len(v) >= 13 for v in values):   # 毫秒时间戳
        return True
    return False


# ---------------------------------------------------------------- HAR 解析

class Endpoint(object):
    def __init__(self, method, host, path):
        self.method = method
        self.host = host
        self.path = path
        self.scheme = "https"
        self.count = 0
        self.statuses = []
        self.times = []
        self.query = OrderedDict()        # name -> [values]
        self.query_noise = set()
        self.req_headers = OrderedDict()  # name -> value
        self.req_schema = None            # Schema or None
        self.req_raw = []                 # 原始请求体文本（最多留 2 份）
        self.req_mime = "application/json"
        self.resp_schema = None
        self.resp_raw = None
        self.first_url = None
        self.content_type = ""
        self.description = ""             # 接口中文描述

    @property
    def key(self):
        return "%s %s" % (self.method, self.path)

    @property
    def tag(self):
        segs = [s for s in self.path.split("/") if s]
        return segs[-2] if len(segs) >= 2 else (segs[0] if segs else "default")


def match_description(method, path):
    """根据 method + path 匹配接口描述（精确优先，正则兜底）"""
    for m, pattern, desc in ENDPOINT_DESCRIPTIONS:
        if m != method:
            continue
        if isinstance(pattern, _re.Pattern):
            if pattern.search(path):
                return desc
        else:
            if pattern == path or pattern in path:
                return desc
    return ""


def parse_har(path, host_filter=None, no_mask=False, skip_static=True):
    with open(path, "r", encoding="utf-8") as f:
        har = json.load(f)
    entries = har.get("log", {}).get("entries", [])
    total = len(entries)

    groups = OrderedDict()
    skipped = 0

    for entry in entries:
        req = entry.get("request", {})
        resp = entry.get("response", {})
        url = req.get("url", "")
        if not url:
            skipped += 1
            continue

        scheme, netloc, raw_path, query = split_url(url)
        if host_filter and host_filter not in netloc:
            skipped += 1
            continue

        low = raw_path.lower()
        if skip_static and low.endswith(STATIC_SUFFIX):
            skipped += 1
            continue

        rtype = entry.get("_resourceType", "")
        method = req.get("method", "GET").upper()

        # 只看 XHR / fetch / 明确是 JSON 的
        ct_resp = ""
        for h in resp.get("headers", []):
            if h.get("name", "").lower() == "content-type":
                ct_resp = h.get("value", "")
        ct_req = ""
        for h in req.get("headers", []):
            if h.get("name", "").lower() == "content-type":
                ct_req = h.get("value", "")

        is_json = "json" in ct_resp.lower() or "json" in ct_req.lower()
        if not (is_json or rtype in ("xhr", "fetch")):
            skipped += 1
            continue

        path = normalize_path(raw_path)
        key = "%s %s" % (method, path)
        ep = groups.get(key)
        if ep is None:
            ep = Endpoint(method, netloc, path)
            ep.scheme = scheme or "https"
            ep.first_url = url
            ep.content_type = ct_resp
            # 自动匹配接口描述
            ep.description = match_description(method, raw_path)
            groups[key] = ep

        ep.count += 1
        ep.statuses.append(resp.get("status"))
        ep.times.append(entry.get("time"))

        # query 参数
        for qn, qv in query:
            ep.query.setdefault(qn, []).append(qv)
        # 请求头（只留首份即可）
        if not ep.req_headers:
            for h in req.get("headers", []):
                n, v = h.get("name", ""), h.get("value", "")
                if n.lower().startswith(":"):
                    continue
                ep.req_headers[n] = v if no_mask else mask_sensitive(n, v)
        # 请求体
        pd = req.get("postData") or {}
        text = pd.get("text", "")
        if pd.get("mimeType"):
            ep.req_mime = pd["mimeType"].split(";")[0].strip()
        obj = try_json(text)
        if obj is not None:
            sch = infer(obj)
            ep.req_schema = sch if ep.req_schema is None else merge(ep.req_schema, sch)
        elif text:
            if len(ep.req_raw) < 2:
                ep.req_raw.append(text)
        # 响应体
        cont = resp.get("content", {})
        rtext = cont.get("text", "")
        if rtext:
            robj = try_json(rtext)
            if robj is not None:
                sch = infer(robj)
                ep.resp_schema = sch if ep.resp_schema is None else merge(ep.resp_schema, sch)
                if ep.resp_raw is None:
                    ep.resp_raw = rtext

    # 标记噪声 query 参数
    for ep in groups.values():
        for qn, qvs in ep.query.items():
            if is_noise_param(qn, qvs):
                ep.query_noise.add(qn)

    return total, list(groups.values()), skipped


def try_json(text):
    if not text:
        return None
    t = text.strip()
    if not (t.startswith("{") or t.startswith("[")):
        return None
    try:
        return json.loads(t)
    except Exception:
        return None


# ---------------------------------------------------------------- Markdown 渲染

def fmt_json(obj, limit=2000):
    s = json.dumps(obj, ensure_ascii=False, indent=2)
    if len(s) > limit:
        s = s[:limit] + "\n…（已截断，完整结构见上方字段表）"
    return s


def render_table(rows, indent_char="　"):
    if not rows:
        return "> 无\n"
    out = ["| 字段 | 类型 | 必含 | 示例 | 说明 |", "| --- | --- | --- | --- | --- |"]
    for r in rows:
        pad = indent_char * r["depth"]
        req = "是" if r["required"] else "否"
        out.append("| %s`%s` | %s | %s | %s | %s |" % (
            pad, r["path"], r["type"], req, r["example"], r["desc"]))
    return "\n".join(out)


def render_curl(ep, no_mask=False):
    url = "%s://%s%s" % (ep.scheme, ep.host, ep.path)
    qs = [(k, v[0]) for k, v in ep.query.items() if k not in ep.query_noise]
    if qs:
        url += "?" + "&".join("%s=%s" % (k, v) for k, v in qs)
    parts = ["curl -X %s '%s'" % (ep.method, url)]
    for n, v in ep.req_headers.items():
        if n.lower() in ("host", "content-length", "connection"):
            continue
        if not no_mask and is_sensitive(n):
            v = MASK_VALUE
        parts.append("  -H '%s: %s'" % (n, trunc_str(v, 120)))
    if ep.req_schema is not None:
        body = ep.req_schema.json_safe_example()
        parts.append("  -d '%s'" % json.dumps(body, ensure_ascii=False))
    elif ep.req_raw:
        parts.append("  -d '%s'" % trunc_str(ep.req_raw[0], 300))
    return " \\\n".join(parts)


def render_markdown(eps, meta, no_mask=False, table_rows_limit=200):
    L = []
    L.append("# %s" % meta.get("title", "接口文档"))
    L.append("")
    L.append("> 由 HAR 抓包自动生成 · 生成时间 %s · 源文件 `%s`" % (meta["generated_at"], meta["source"]))
    L.append(">")
    L.append("> 抓包共 **%d** 条请求，归并后得到 **%d** 个接口。"
             % (meta["total_entries"], len(eps)))
    if not no_mask:
        L.append("> 凭证类字段（token / session / cookie 等）已脱敏为 `***`，联调前需替换为真实值。")
    L.append("> 字段表中的「必含」= 该字段在**全部**抓包样本中均出现，仅代表实际抓到的情况，"
             "真实是否必填以服务端校验为准。")
    L.append("")

    # 目录
    L.append("## 目录")
    L.append("")
    by_tag = group_by_tag(eps)
    for tag, items in by_tag.items():
        L.append("### %s" % tag)
        L.append("")
        for i, ep in enumerate(items):
            anchor = anchor_of(ep)
        desc = ep.description or describe_endpoint(ep.path)
        L.append("- [%s `%s`](%s) —— %s" % (
            ep.method, ep.path, anchor, desc or "-"))
        L.append("")

    L.append("---")
    L.append("")

    L.extend(render_conventions(common_conventions(eps)))

    for tag, items in by_tag.items():
        L.append("## 分组：%s" % tag)
        L.append("")
        for ep in items:
            L.append('<a id="%s"></a>' % anchor_of(ep).lstrip("#"))
            L.append("")
            L.append("### %s `%s`" % (ep.method, ep.path))
            L.append("")
            L.append("| 项 | 值 |")
            L.append("| --- | --- |")
            L.append("| 接口地址 | `%s://%s%s` |" % (ep.scheme, ep.host, ep.path))
            L.append("| 请求方法 | **%s** |" % ep.method)
            L.append("| 接口名称 | %s |" % (describe_endpoint(ep.path) or "（待补充）"))
            if ep.description:
                L.append("| **接口描述** | %s |" % ep.description)
            else:
                L.append("| **接口描述** | *（未配置，请根据业务补充）* |")
            L.append("| 响应类型 | `%s` |" % (ep.content_type.split(";")[0] or "-"))
            L.append("| 状态码 | %s |" % ", ".join(str(s) for s in sorted(set(ep.statuses))))
            L.append("| 抓包次数 | %d 次 |" % ep.count)
            avg = sum(t for t in ep.times if isinstance(t, (int, float))) / max(1, len([t for t in ep.times if isinstance(t, (int, float))]))
            L.append("| 平均耗时 | %.0f ms |" % avg)
            L.append("")

            # Query 参数
            real_q = [(k, v) for k, v in ep.query.items() if k not in ep.query_noise]
            if real_q:
                L.append("#### URL 参数（Query）")
                L.append("")
                L.append("| 参数名 | 示例值 | 说明 |")
                L.append("| --- | --- | --- |")
                for k, v in real_q:
                    L.append("| `%s` | `%s` | %s |" % (k, trunc_str(urldecode_rich(v[0]), 40), describe_field(k)))
                L.append("")
            if ep.query_noise:
                L.append("> 已忽略随机参数：%s（防缓存时间戳，每次请求不同）"
                         % ", ".join("`%s`" % n for n in sorted(ep.query_noise)))
                L.append("")

            # 请求头
            L.append("#### 请求头")
            L.append("")
            L.append("| 名称 | 值 |")
            L.append("| --- | --- |")
            shown = 0
            for n, v in ep.req_headers.items():
                if n.lower() in ("host", "content-length", "connection", "accept-encoding"):
                    continue
                L.append("| `%s` | `%s` |" % (n, trunc_str(urldecode_rich(v), 80)))
                shown += 1
                if shown >= 20:
                    L.append("| … | （其余 %d 项已省略） |" % (len(ep.req_headers) - shown))
                    break
            L.append("")

            # 请求体
            L.append("#### 请求体（Body）")
            L.append("")
            if ep.req_schema is not None:
                if ep.req_schema.type != "object":
                    L.append("类型：`%s`" % ep.req_schema.type_label())
                    L.append("")
                else:
                    rows = ep.req_schema.flatten()
                    if len(rows) > table_rows_limit:
                        rows = rows[:table_rows_limit]
                    L.append(render_table(rows))
                    L.append("")
                L.append("**请求示例**")
                L.append("")
                L.append("```json")
                L.append(fmt_json(ep.req_schema.json_safe_example()))
                L.append("```")
            elif ep.req_raw:
                L.append("> 非 JSON 格式（`%s`）" % ep.req_mime)
                L.append("")
                L.append("```")
                L.append(trunc_str(ep.req_raw[0], 1200))
                L.append("```")
            else:
                L.append("> 无请求体")
            L.append("")

            # 响应
            L.append("#### 响应字段")
            L.append("")
            if ep.resp_schema is not None:
                rows = ep.resp_schema.flatten()
                truncated = False
                if len(rows) > table_rows_limit:
                    rows = rows[:table_rows_limit]
                    truncated = True
                L.append(render_table(rows))
                if truncated:
                    L.append("")
                    L.append("> 字段过多，仅展示前 %d 行，完整结构见下方示例。" % table_rows_limit)
                L.append("")
                L.append("**响应示例**")
                L.append("")
                L.append("```json")
                L.append(fmt_json(ep.resp_schema.json_safe_example(), 2500))
                L.append("```")
            else:
                L.append("> HAR 未记录响应内容")
            L.append("")

            L.append("#### 调用示例")
            L.append("")
            L.append("```bash")
            L.append(render_curl(ep, no_mask))
            L.append("```")
            L.append("")
            L.append("---")
            L.append("")

    return "\n".join(L)


def common_conventions(eps):
    """统计跨接口的共性：公共请求头、统一响应封装、分页约定"""
    from collections import Counter
    n = len(eps)
    if n == 0:
        return None

    hdr_cnt, hdr_val = Counter(), {}
    for ep in eps:
        for k, v in ep.req_headers.items():
            hdr_cnt[k] += 1
            hdr_val.setdefault(k, v)
    common_hdr = [(k, hdr_val[k]) for k, c in hdr_cnt.items()
                  if c == n and k.lower() not in
                  ("host", "content-length", "connection", "accept-encoding")]
    common_hdr.sort(key=lambda x: x[0].lower())

    resp_cnt, resp_schema = Counter(), {}
    for ep in eps:
        if ep.resp_schema is not None and ep.resp_schema.properties:
            for k, v in ep.resp_schema.properties.items():
                resp_cnt[k] += 1
                resp_schema.setdefault(k, v)
    common_resp = [(k, resp_schema[k]) for k, c in resp_cnt.items() if c == n]
    common_resp.sort(key=lambda x: -resp_cnt[x[0]])

    # 分页约定
    paged = []
    for ep in eps:
        props = ep.req_schema.properties if ep.req_schema else {}
        has_req = "pageNum" in props or "pageSize" in props
        rprops = {}
        if ep.resp_schema and ep.resp_schema.properties:
            dp = ep.resp_schema.properties.get("data")
            if dp and dp.properties:
                rprops = dp.properties
        has_resp = "total" in rprops and ("rows" in rprops or "list" in rprops)
        if has_req or has_resp:
            paged.append(ep)

    return {
        "n": n,
        "headers": common_hdr,
        "resp_fields": common_resp,
        "paged": paged,
    }


def render_conventions(conv):
    if not conv:
        return []
    L = ["## 通用约定", ""]
    n = conv["n"]

    if conv["headers"]:
        L.append("### 公共请求头")
        L.append("")
        L.append("以下请求头在全部 **%d** 个接口中均出现，属于全局必传项：" % n)
        L.append("")
        L.append("| 名称 | 示例值 | 说明 |")
        L.append("| --- | --- | --- |")
        for k, v in conv["headers"]:
            L.append("| `%s` | `%s` | %s |" % (k, trunc_str(urldecode_rich(v), 60), describe_field(k)))
        L.append("")

    if conv["resp_fields"]:
        L.append("### 统一响应封装")
        L.append("")
        L.append("以下字段在全部 **%d** 个接口的响应外层均出现：" % n)
        L.append("")
        L.append("| 字段 | 类型 | 说明 |")
        L.append("| --- | --- | --- |")
        for k, v in conv["resp_fields"]:
            extra = ""
            if k == "code":
                extra = "，`200` 表示业务成功"
            L.append("| `%s` | %s | %s%s |" % (k, v.type_label(), describe_field(k), extra))
        L.append("")
        L.append("> 各接口 `data` 的实际结构见下方逐接口字段表。")
        L.append("")

    if conv["paged"]:
        L.append("### 分页约定")
        L.append("")
        L.append("检测到 **%d** 个接口使用分页：" % len(conv["paged"]))
        L.append("")
        L.append("- 请求：`pageNum`（页码，从 1 开始）、`pageSize`（每页条数）")
        L.append("- 响应：`data.total`（总记录数）、`data.rows`（当前页数据）")
        L.append("")
        for ep in conv["paged"]:
            L.append("  - `%s %s`" % (ep.method, ep.path))
        L.append("")

    L.append("---")
    L.append("")
    return L


def group_by_tag(eps):
    d = OrderedDict()
    for ep in eps:
        d.setdefault(ep.tag, []).append(ep)
    return d


def anchor_of(ep):
    s = re.sub(r"[^0-9a-zA-Z\u4e00-\u9fff]+", "-", "%s-%s" % (ep.method.lower(), ep.path))
    return "#" + s.strip("-").lower()


# ---------------------------------------------------------------- OpenAPI 渲染

def render_openapi(eps, meta):
    paths = OrderedDict()
    tags_seen = OrderedDict()

    for ep in sorted(eps, key=lambda e: (e.path, e.method)):
        tag = ep.tag
        tags_seen[tag] = tag
        op = OrderedDict()
        op["tags"] = [tag]
        op["summary"] = (ep.description or describe_endpoint(ep.path) or ep.path)
        desc_parts = []
        if ep.description:
            desc_parts.append(ep.description)
        desc_parts.append("抓包捕获 %d 次，状态码：%s" % (
            ep.count, ", ".join(str(s) for s in sorted(set(ep.statuses)))))
        op["description"] = "\n".join(desc_parts)

        # query 参数
        params = []
        for qn, qvs in ep.query.items():
            if qn in ep.query_noise:
                continue
            p = OrderedDict()
            p["name"] = qn
            p["in"] = "query"
            p["required"] = len(qvs) == ep.count
            p["schema"] = scalar_schema(qvs)
            p["example"] = qvs[0]
            p["description"] = describe_field(qn)
            params.append(p)
        if params:
            op["parameters"] = params

        # 请求体
        if ep.req_schema is not None:
            mime = ep.req_mime or "application/json"
            op["requestBody"] = OrderedDict([
                ("required", True),
                ("content", {mime: {"schema": ep.req_schema.to_json_schema()}}),
            ])
        elif ep.req_raw:
            op["requestBody"] = OrderedDict([
                ("required", True),
                ("content", {ep.req_mime or "text/plain": {"example": trunc_str(ep.req_raw[0], 500)}}),
            ])

        # 认证头
        sec_headers = [n for n in ep.req_headers if is_sensitive(n)]
        if sec_headers:
            op.setdefault("parameters", []).extend([
                OrderedDict([("name", n), ("in", "header"), ("required", True),
                             ("description", "（已脱敏）凭证头"),
                             ("schema", {"type": "string"})])
                for n in sec_headers
            ])

        # 响应
        status = str(ep.statuses[0] if ep.statuses else 200)
        resp = OrderedDict()
        resp["description"] = "成功"
        if ep.resp_schema is not None:
            mime = (ep.content_type.split(";")[0] or "application/json")
            body = OrderedDict()
            body["schema"] = ep.resp_schema.to_json_schema()
            ex = ep.resp_schema.json_safe_example()
            if ex is not None:
                body["example"] = ex
            resp["content"] = {mime: body}
        op["responses"] = {status: resp}

        paths.setdefault(ep.path, OrderedDict())[ep.method.lower()] = op

    hosts = sorted({ep.host for ep in eps})
    servers = [{"url": "%s://%s" % (ep.scheme, h)} for h in hosts]

    return OrderedDict([
        ("openapi", "3.0.3"),
        ("info", OrderedDict([
            ("title", meta.get("title", "接口文档")),
            ("version", meta.get("api_version", "1.0.0")),
            ("description", "由 HAR 抓包自动生成，源文件：%s" % meta["source"]),
        ])),
        ("servers", servers),
        ("tags", [{"name": t} for t in tags_seen]),
        ("paths", paths),
    ])


def scalar_schema(values):
    uniq = list(OrderedDict.fromkeys(values))
    sch = infer(uniq[0])
    if len(uniq) > 1:
        for v in uniq[1:]:
            sch = merge(sch, infer(v))
    out = sch.to_json_schema()
    out.pop("example", None)
    return out or {"type": "string"}


# ---------------------------------------------------------------- main

def main(argv=None):
    ap = argparse.ArgumentParser(
        description="从 HAR 抓包文件生成接口文档（Markdown + OpenAPI 3.0）",
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("har", help="HAR 文件路径")
    ap.add_argument("-o", "--out", default=".", help="输出目录，默认当前目录")
    ap.add_argument("--format", default="both", choices=["md", "openapi", "both"],
                    help="输出格式，默认 both")
    ap.add_argument("--host", default=None, help="只保留该域名（模糊匹配）")
    ap.add_argument("--title", default=None, help="文档标题")
    ap.add_argument("--api-version", default="1.0.0", help="OpenAPI info.version")
    ap.add_argument("--md-name", default="接口文档.md", help="Markdown 文件名")
    ap.add_argument("--oas-name", default="openapi.json", help="OpenAPI 文件名")
    ap.add_argument("--no-mask", action="store_true",
                    help="不脱敏（会明文输出 token/session，谨慎）")
    ap.add_argument("--keep-static", action="store_true", help="不过滤静态资源")
    ap.add_argument("--max-rows", type=int, default=200, help="单个字段表最大行数")
    args = ap.parse_args(argv)

    if not os.path.isfile(args.har):
        print("找不到文件：%s" % args.har, file=sys.stderr)
        return 2

    total, eps, skipped = parse_har(
        args.har, host_filter=args.host,
        no_mask=args.no_mask, skip_static=not args.keep_static)

    if not eps:
        print("没筛出任何接口，试试放宽 --host 或 --keep-static", file=sys.stderr)
        return 1

    title = args.title or (args.host or os.path.basename(args.har)) + " 接口文档"
    meta = {
        "title": title,
        "source": os.path.basename(args.har),
        "generated_at": now_str(),
        "total_entries": total,
        "api_version": args.api_version,
    }

    os.makedirs(args.out, exist_ok=True)
    written = []

    if args.format in ("md", "both"):
        md = render_markdown(eps, meta, no_mask=args.no_mask,
                             table_rows_limit=args.max_rows)
        p = os.path.join(args.out, args.md_name)
        with open(p, "w", encoding="utf-8") as f:
            f.write(md)
        written.append(p)

    if args.format in ("openapi", "both"):
        oas = render_openapi(eps, meta)
        p = os.path.join(args.out, args.oas_name)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(oas, f, ensure_ascii=False, indent=2)
        written.append(p)

    print("抓包条目：%d  过滤：%d  归并接口：%d" % (total, skipped, len(eps)))
    print("")
    for ep in sorted(eps, key=lambda e: (e.tag, e.path)):
        qn = len([k for k in ep.query if k not in ep.query_noise])
        print("  %-6s %-46s  调用%2d次  query:%d  body:%s  resp:%s" % (
            ep.method, ep.path, ep.count, qn,
            "有" if ep.req_schema is not None or ep.req_raw else "无",
            "有" if ep.resp_schema is not None else "无"))
    print("")
    for p in written:
        print("已生成：%s" % os.path.abspath(p))
    if not args.no_mask:
        print("提示：凭证字段已脱敏；需要明文请加 --no-mask")
    return 0


def now_str():
    import datetime
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M")


if __name__ == "__main__":
    sys.exit(main())
