from rest_framework.pagination import PageNumberPagination


class DefaultPagination(PageNumberPagination):
    """20 rows a page; clients can ask for up to 100 with ?page_size=."""

    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100
