const createFooter = function () {
    const footer = document.createElement("footer");
    footer.classList.add("footer")
    footer.innerHTML = '&copy 2020 - Team Taskr - We Can {Code} IT'
    return footer;
}
export {
    createFooter
}