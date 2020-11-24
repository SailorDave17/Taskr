package com.taskr.core.Resources;

import javax.persistence.Entity;
import javax.persistence.GeneratedValue;
import javax.persistence.Id;

@Entity
public class TaskTemplate {
    @Id
    @GeneratedValue
    private long id;
    private String name;
    private long minutesExpectedToComplete = 0;
    private String description;

    public TaskTemplate(String name) {
        this.name = name;
    }

    public TaskTemplate() {

    }

    public String getName() {
        return  name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public long getId() {
        return id;
    }

    public long getMinutesExpectedToComplete() {
        return minutesExpectedToComplete;
    }

    public void setMinutesExpectedToComplete(long minutesExpectedToComplete) {
        this.minutesExpectedToComplete = minutesExpectedToComplete;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }
}
