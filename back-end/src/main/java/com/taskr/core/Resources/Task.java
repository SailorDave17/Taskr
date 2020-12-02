package com.taskr.core.Resources;

import com.fasterxml.jackson.annotation.JsonBackReference;

import javax.persistence.*;
import java.util.Date;

@Entity
public class Task {
    @Id
    @GeneratedValue
    private long id;
    @JsonBackReference
    @ManyToOne
    private User ownedBy;
    private String title;
    private String description;
    private Long minutesExpectedToComplete;
    private long templateId;
    private Date dueBy;
    private Boolean done;
    private Long actualWorkTime = 0L;

    public Task(User owner, TaskTemplate taskTemplate) {
        this.title = taskTemplate.getName();
        this.ownedBy = owner;
        this.templateId = taskTemplate.getId();
        if (taskTemplate.getDescription() != null){
            this.description = taskTemplate.getDescription();
        }
        if (taskTemplate.getMinutesExpectedToComplete() != 0L){
            this.minutesExpectedToComplete = taskTemplate.getMinutesExpectedToComplete();
        }
    }

    public Task() {

    }

    public long getId() {
        return id;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public Long getMinutesExpectedToComplete() {
        return minutesExpectedToComplete;
    }

    public void setMinutesExpectedToComplete(Long minutesExpectedToComplete) {
        this.minutesExpectedToComplete = minutesExpectedToComplete;
    }

    public Date getDueBy() {
        return dueBy;
    }

    public void setDueBy(Date dueBy) {
        this.dueBy = dueBy;
    }

    public long getTemplateId() {
        return templateId;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public User getOwnedBy() {
        return ownedBy;
    }

    public void setOwnedBy(User newOwner) {
        this.ownedBy = newOwner;
    }
    public Boolean isDone() {
        return done;
    }

    public void setDone(Boolean trueOrFalse) {
        this.done = trueOrFalse;
    }

    public Long getActualWorkTime() {
        return actualWorkTime;
    }

    public void setActualWorkTime(Long actualWorkTime) {
        this.actualWorkTime = actualWorkTime;
    }
}
